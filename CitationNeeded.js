/**
 * Wikipedia Citation Needed Gadget
 *
 * Adds a popup to citation-needed templates in read mode, with a link
 * directly into adding the citation in VisualEditor.
 */
/* global mw, $, mediaWiki */

( function () {
	'use strict';

	// TODO: check how encapsulated CNs interact with the selector

	// TODO: parsoid read views would presumably simplify a great many "work
	// out which CN we were talking about" checks...

	if ( !Object.hasOwn(HTMLElement.prototype, "popover") ) {
		return;
	}

	// Extracting this from MediaWiki:Visualeditor-template-tools-definition.json would be ideal...
	const CITATION_NEEDED_TEMPLATES = [ 'Citation needed', 'Cn', 'Fact', 'CN', 'Citation Needed', 'Citationneeded', 'Cite needed', 'Citation-needed' ];
	const CITATION_NEEDED_SELECTOR = 'sup.Template-Fact';
	const CITATION_TITLE_SELECTOR = 'a > span[title]';

	function addStyle( element, styles ) {
		Object.assign( element.style, styles );
	}

	function ancestorMatches( element, test ) {
		while ( element.parentElement && element.parentElement !== document.body ) {
			if ( test( element ) ) {
				return true;
			}
			element = element.parentElement;
		}
		return false;
	}

	function elementInUneditableContext( element ) {
		// TODO: parsoid read views would let any template-contained CNs be filtered out here...
		return ancestorMatches( element, ( ancestor ) => (
			ancestor.nodeName === 'TD' ||
			ancestor.classList.contains( 'infobox' )
		) );
	}

	function init() {
		mw.loader.enqueue( [ 'mediawiki.base' ], () => {
			// Only run in article namespace
			if ( mw.config.get( 'wgNamespaceNumber' ) !== 0 ) return;

			const popover = document.createElement( 'div' );
			popover.popover = 'auto';
			addStyle( popover, {
				inset: 'unset', // otherwise it's centered in the viewport
				position: 'absolute',
				maxWidth: '30%',
				// maxHeight: '3em',
				fontSize: 'small',
			} );

			const label = document.createElement( 'span' );
			popover.appendChild( label );
			const button = document.createElement( 'button' );
			button.innerText = 'Provide a citation!';
			addStyle( button, { margin: '1ex auto 0.33ex' } );
			popover.appendChild( button );
			document.body.appendChild( popover );

			let closeTimeout;

			function showPopover( element, details, index ) {
				clearTimeout( closeTimeout );

				const rect = element.getBoundingClientRect();
				addStyle( popover, {
					top: `${ window.scrollY + rect.top}px`,
					left: `${ window.scrollX + rect.right}px`,
				} );
				label.innerText = details || 'Supporting information is needed';
				if ( index !== false ) {
					button.dataset.citationIndex = index;
					addStyle( button, { display: 'block' } );
				} else {
					addStyle( button, { display: 'none' } );
				}
				popover.showPopover();
			}

			function closePopover() {
				popover.hidePopover();
				delete button.dataset.citationIndex;
			}

			function startClosePopover() {
				closeTimeout = setTimeout( closePopover, 300 );
			}

			let initialSuggestions = mw.user.options.get( 'visualeditor-editcheck-suggestions' );
			let neededIndex = null;
			button.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				// Cache this so it's not gone when the popover closes
				neededIndex = parseInt( button.dataset.citationIndex, 10 );
				// TODO: make a supported way to disable this because the sidebar gets in the way
				mw.user.options.set( 'visualeditor-editcheck-suggestions', false );
				// Launch VE
				mw.libs.ve.activateVe( 'visual' );
				closePopover();
			} );

			mw.hook( 've.newTarget' ).add( ( target ) => {
				if ( target.constructor.static.name !== 'article' ) {
					return;
				}
				target.on( 'surfaceReady', () => {
					if ( neededIndex === null ) {
						return;
					}
					const surface = target.getSurface();
					if ( surface.getMode() !== 'visual' ) {
						return;
					}
					const surfaceModel = surface.getModel();

					surface.on( 'destroy', () => {
						neededIndex = null;
						mw.user.options.set( 'visualeditor-editcheck-suggestions', initialSuggestions );
					} );

					const citationNeededs = surfaceModel.documentModel.getNodesByType( 'mwTransclusionInline', true )
						.filter( ( node ) => {
							// Normalize these, because just `.template` contains the original input which isn't sensitive to the first character...
							const templates = node.getPartsList().map( ( part ) => mw.Title.newFromText( part.templatePage ).getNameText() );
							return templates.find( ( template ) => CITATION_NEEDED_TEMPLATES.includes( template ) )
						} );
					const citationNeeded = citationNeededs[ neededIndex ];
					if ( !citationNeeded ) {
						return;
					}

					const fragment = surfaceModel.getLinearFragment( citationNeeded.getOuterRange() );
					fragment.select();

					// Ideally we'd reuse ve.ui.MWCitationNeededContextItem.prototype.onAddClick here, since it does exactly what we want...

					// The `replace` here is currently broken (T418037), and also having access to the lifecycle is useful...
					// const action = ve.ui.actionFactory.create( 'citoid', surface );
					// action.open( { replace: true } );

					surfaceModel.pushStaging();
					fragment.delete();
					const windowAction = ve.ui.actionFactory.create( 'window', surface, 'userscript' );
					windowAction.open( 'citoid' ).then( ( instance ) => instance.closing ).then( ( citoidData ) => {
						const citoidOrCiteDataDeferred = ve.createDeferred();
						if ( citoidData && citoidData.action === 'manual-choose' ) {
							// The plain reference dialog has been launched. Wait for the data from
							// the basic Cite closing promise instead.
							surface.getDialogs().once( 'closing', ( win, closed, citeData ) => {
								citoidOrCiteDataDeferred.resolve( citeData );
							} );
						} else {
							// "Auto"/"re-use"/"close" means Citoid is finished and we can
							// use the data form the Citoid closing promise.
							citoidOrCiteDataDeferred.resolve( citoidData );
						}
						return citoidOrCiteDataDeferred.promise();
					} ).then( ( data ) => {
						if ( data ) {
							surfaceModel.applyStaging();
						} else {
							surfaceModel.popStaging();
						}
					}, () => {
						surfaceModel.popStaging();
					} ).always( () => {
						if ( !surfaceModel.hasBeenModified() ) {
							target.tryTeardown();
						} else {
							target.showSaveDialog();
						}
					} );
				} );
			} );

			mw.hook( 'wikipage.content' ).add( ( $content ) => {
				if ( !$content.is( '#mw-content-text' ) ) {
					return;
				}
				let internalIndex = 0;
				$content[ 0 ].querySelectorAll( CITATION_NEEDED_SELECTOR ).forEach( ( element ) => {
					const inTemplate = elementInUneditableContext( element );

					let details;
					const span = element.querySelector( CITATION_TITLE_SELECTOR );
					if ( span ) {
						details = span.getAttribute( 'title' );
						span.removeAttribute( 'title' );
					}
					const index = internalIndex;
					element.addEventListener( 'mouseenter', () => {
						showPopover( element, details, inTemplate ? false : index );
					} );
					element.addEventListener( 'mouseleave', startClosePopover );

					if ( !inTemplate ) {
						internalIndex++;
					}
				} );
			} );

			popover.addEventListener( 'mouseenter', () => {
				clearTimeout( closeTimeout );
			} );
			popover.addEventListener( 'mouseleave', startClosePopover );
		} );
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

}() );
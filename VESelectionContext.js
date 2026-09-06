/**
 * VE selection probe.
 *
 * This script monitors the VisualEditor surface in visual mode and in source mode.
 * When the selection is not collapsed, the script makes a description of the
 * selection and shows the description in a context item.
 * If you set an endpoint, the script also sends the description to that endpoint
 * and shows the response in the same context item.
 *
 * To install the script, add this line to Special:MyPage/common.js:
 *   mw.loader.load( 'https://meta.wikimedia.org/w/index.php?title=User:DLynch_(WMF)/VESelectionContext.js&action=raw&ctype=text/javascript' );
 *
 * To configure the script, set window.veSelectionProbe above that mw.loader call.
 */
// <nowiki>
( function () {
	'use strict';

	var config = window.veSelectionProbe = Object.assign( {
		// If the endpoint is null, the script sends no request.
		// The context item then shows only the offsets.
		endpoint: null,
		// If the method is 'GET', the script puts the payload in a query parameter.
		// A JSON body causes a CORS preflight request. A GET request does not.
		method: 'POST',
		credentials: 'omit',
		// If allowHtml is true, the script puts the response into the editor as HTML.
		// Use only an endpoint that you control.
		allowHtml: false,
		debounceMs: 300,
		// The maximum number of characters of selected text in the payload.
		maxTextSample: 1000,
		label: 'Selection probe',
		icon: 'notice'
	}, window.veSelectionProbe );

	var NAME = 'selectionProbe';

	/* Payload */

	function utf8Length( text ) {
		return new TextEncoder().encode( text ).length;
	}

	function nodeTypePath( node ) {
		var path = [];
		// The document node is not in the linear model. Stop below it.
		for ( var n = node; n && n.getParent(); n = n.getParent() ) {
			path.unshift( n.getType() );
		}
		return path;
	}

	/**
	 * Find the Parsoid identity of a node, or of its nearest ancestor.
	 *
	 * VE loads the page bundle without data-parsoid, thus no DSR data is available.
	 * The id and about attributes stay in the original DOM elements.
	 * A node that the user made in this session has no original DOM element.
	 * For such a node, this function examines the ancestors.
	 */
	function parsoidInfo( node ) {
		var depth = 0;
		// The document node throws if you ask it for original DOM elements. Stop below it.
		for ( var n = node; n && n.getParent(); n = n.getParent(), depth++ ) {
			var el = n.getOriginalDomElements()[ 0 ];
			if ( !el || el.nodeType !== Node.ELEMENT_NODE ) {
				continue;
			}
			var id = el.getAttribute( 'id' );
			var about = el.getAttribute( 'about' );
			if ( !id && !about ) {
				continue;
			}
			return {
				id: id,
				about: about,
				typeof: el.getAttribute( 'typeof' ),
				tagName: el.nodeName.toLowerCase(),
				nodeType: n.getType(),
				// A depth of 0 shows that the branch node has the attribute.
				ancestorDepth: depth
			};
		}
		return null;
	}

	function describePoint( doc, offset ) {
		var node = doc.getBranchNodeFromOffset( offset );
		if ( !node ) {
			return { veOffset: offset };
		}
		var inner = node.getRange();
		return {
			veOffset: offset,
			nodeType: node.getType(),
			nodeVeRange: { from: inner.start, to: inner.end },
			// A linear offset counts the element items.
			// A text offset counts only the characters.
			offsetInNode: offset - inner.start,
			textOffsetInNode: doc.data.getText( false, new ve.Range( inner.start, offset ) ).length,
			nodePath: nodeTypePath( node ),
			parsoid: parsoidInfo( node )
		};
	}

	function describeSelection( surface, target ) {
		var model = surface.getModel(),
			doc = model.getDocument(),
			selection = model.getSelection(),
			range = selection.getCoveringRange(),
			mode = surface.getMode();

		var payload = {
			mode: mode,
			wiki: mw.config.get( 'wgDBname' ),
			page: mw.config.get( 'wgPageName' ),
			revision: ( target && target.revid ) || mw.config.get( 'wgRevisionId' ),
			// The section is not null if the user edits one section.
			// All offsets are then relative to the wikitext of that section.
			section: target ? target.section : null,
			selectionType: selection.getName(),
			// The values of from and to are in selection order. Thus from can be
			// larger than to.
			veRange: range ? { from: range.from, to: range.to } : null
		};

		if ( !range ) {
			return payload;
		}

		if ( mode === 'source' ) {
			var beforeFrom = doc.data.getSourceText( new ve.Range( 0, range.from ) ),
				beforeTo = doc.data.getSourceText( new ve.Range( 0, range.to ) );
			payload.source = {
				// UTF-16 code units. These values agree with JavaScript string indexes.
				from: beforeFrom.length,
				to: beforeTo.length,
				// Parsoid DSR uses UTF-8 bytes by default. Send both units.
				fromByte: utf8Length( beforeFrom ),
				toByte: utf8Length( beforeTo )
			};
			payload.text = doc.data.getSourceText( range ).slice( 0, config.maxTextSample );
		} else {
			payload.visual = {
				from: describePoint( doc, range.from ),
				to: describePoint( doc, range.to )
			};
			payload.text = doc.data.getText( false, range ).slice( 0, config.maxTextSample );
		}

		return payload;
	}

	/* Request */

	function createProbe( payload ) {
		var probe = {
			payload: payload,
			controller: null,
			promise: null,
			result: null,
			error: null
		};

		if ( !config.endpoint ) {
			return probe;
		}

		probe.controller = new AbortController();

		var url = config.endpoint,
			options = {
				method: config.method,
				credentials: config.credentials,
				signal: probe.controller.signal
			};

		if ( config.method === 'GET' ) {
			url += ( url.indexOf( '?' ) === -1 ? '?' : '&' ) +
				'selection=' + encodeURIComponent( JSON.stringify( payload ) );
		} else {
			options.headers = { 'Content-Type': 'application/json' };
			options.body = JSON.stringify( payload );
		}

		// The promise always fulfils. The context item reads probe.result and
		// probe.error at each rebuild, thus a late rebuild needs no promise.
		probe.promise = fetch( url, options ).then( function ( response ) {
			return response.text().then( function ( text ) {
				probe.result = { status: response.status, ok: response.ok, text: text };
			} );
		} ).catch( function ( error ) {
			probe.error = error;
		} );

		return probe;
	}

	/* Display */

	// Make a table of the offsets. The script shows this table also when no
	// endpoint is set, thus you can read the offsets during development.
	function buildOffsetTable( payload ) {
		var rows = [];

		rows.push( [ 'mode', payload.mode +
			( payload.section === null || payload.section === undefined ?
				'' : ' (section ' + payload.section + ')' ) ] );

		if ( payload.veRange ) {
			rows.push( [ 've range', payload.veRange.from + ' - ' + payload.veRange.to ] );
		} else {
			rows.push( [ 'selection', payload.selectionType + ', no covering range' ] );
		}

		if ( payload.source ) {
			rows.push( [ 'wikitext', payload.source.from + ' - ' + payload.source.to ] );
			rows.push( [ 'wikitext bytes', payload.source.fromByte + ' - ' + payload.source.toByte ] );
		}

		if ( payload.visual ) {
			[ 'from', 'to' ].forEach( function ( end ) {
				var point = payload.visual[ end ],
					parsoid = point.parsoid;
				if ( !point.nodeType ) {
					return;
				}
				rows.push( [ end + ' node', point.nodeType +
					' +' + point.offsetInNode + ' (text +' + point.textOffsetInNode + ')' ] );
				rows.push( [ end + ' parsoid', parsoid ?
					( parsoid.id || parsoid.about ) +
						( parsoid.ancestorDepth ? ' (ancestor +' + parsoid.ancestorDepth + ')' : '' ) :
					'none' ] );
			} );
		}

		var $table = $( '<table>' ).addClass( 've-ui-selectionProbe-offsets' );
		rows.forEach( function ( row ) {
			$table.append( $( '<tr>' ).append(
				$( '<th>' ).text( row[ 0 ] ),
				$( '<td>' ).text( row[ 1 ] )
			) );
		} );
		return $table;
	}

	function renderResponse( $output, probe ) {
		$output.empty();

		if ( !probe.promise ) {
			$output.append( $( '<p>' ).text( 'No endpoint configured. The script sent nothing.' ) );
			return;
		}
		if ( probe.error ) {
			$output.append( $( '<p>' ).text( 'Request failed: ' + probe.error ) );
			return;
		}
		if ( !probe.result ) {
			$output.append( $( '<p>' ).text( 'Loading...' ) );
			return;
		}
		if ( !probe.result.ok ) {
			$output.append( $( '<p>' ).text( 'HTTP ' + probe.result.status ) );
		}
		if ( config.allowHtml ) {
			$output.append( $.parseHTML( probe.result.text ) );
		} else {
			$output.append( $( '<pre>' ).text( probe.result.text ) );
		}
	}

	function defineContextItem() {
		if ( ve.ui.contextItemFactory.lookup( NAME ) ) {
			return;
		}

		ve.ui.SelectionProbeContextItem = function VeUiSelectionProbeContextItem() {
			ve.ui.SelectionProbeContextItem.super.apply( this, arguments );
			this.$element.addClass( 've-ui-selectionProbeContextItem' );
		};

		OO.inheritClass( ve.ui.SelectionProbeContextItem, ve.ui.PersistentContextItem );

		ve.ui.SelectionProbeContextItem.static.name = NAME;
		ve.ui.SelectionProbeContextItem.static.icon = config.icon;
		ve.ui.SelectionProbeContextItem.static.label = config.label;

		ve.ui.SelectionProbeContextItem.prototype.renderBody = function () {
			var probe = this.data,
				$output = $( '<div>' );

			this.$body.append(
				buildOffsetTable( probe.payload ),
				$( '<details>' ).append(
					$( '<summary>' ).text( 'Full payload' ),
					$( '<pre>' ).text( JSON.stringify( probe.payload, null, '\t' ) )
				),
				$output
			);

			renderResponse( $output, probe );
			if ( probe.promise && !probe.result && !probe.error ) {
				probe.promise.then( function () {
					renderResponse( $output, probe );
				} );
			}
		};

		ve.ui.contextItemFactory.register( ve.ui.SelectionProbeContextItem );

		$( document.head ).append( $( '<style>' ).text( [
			'.ve-ui-selectionProbeContextItem pre { max-height: 12em; overflow: auto; white-space: pre-wrap; }',
			'.ve-ui-selectionProbe-offsets { border-collapse: collapse; }',
			'.ve-ui-selectionProbe-offsets th,',
			'.ve-ui-selectionProbe-offsets td { padding: 0 0.5em 0 0; text-align: left; vertical-align: top; }',
			'.ve-ui-selectionProbe-offsets th { font-weight: normal; opacity: 0.7; white-space: nowrap; }',
			'.ve-ui-selectionProbe-offsets td { font-family: monospace; }'
		].join( '\n' ) ) );
	}

	/* Wiring */

	function attachToSurface( target, surface ) {
		if ( surface.selectionProbeAttached ) {
			return;
		}
		surface.selectionProbeAttached = true;

		var context = surface.getContext(),
			model = surface.getModel(),
			current = null;

		function clear() {
			if ( !current ) {
				return;
			}
			if ( current.controller ) {
				current.controller.abort();
			}
			current = null;
			context.removePersistentSource( NAME );
		}

		model.on( 'select', ve.debounce( function () {
			clear();
			// A null selection reports itself as collapsed. This test covers it.
			if ( model.getSelection().isCollapsed() ) {
				return;
			}
			current = createProbe( describeSelection( surface, target ) );
			// The context reads embeddable from the source object.
			// An embedded item hides the selection that the payload describes.
			context.addPersistentSource( { name: NAME, embeddable: false, data: current } );
		}, config.debounceMs ) );
	}

	function init() {
		// mw.hook keeps the last arguments, thus a handler that you add after the
		// event still runs.
		mw.hook( 've.newTarget' ).add( ( target ) => {
			defineContextItem();
			// The surfaceReady event occurs again after each change between visual mode
			// and source mode, because each change makes a new surface.
			target.on( 'surfaceReady', function () {
				attachToSurface( target, target.getSurface() );
			} );
			// The surface is already there if the target fired surfaceReady before this
			// handler was added. That event keeps no memory.
			if ( target.getSurface() ) {
				attachToSurface( target, target.getSurface() );
			}
		} );
	}

	// A userscript extension can start the script before ResourceLoader defines mw.
	if ( window.mw && mw.hook ) {
		init();
	} else {
		window.addEventListener( 'load', init );
	}
}() );
// </nowiki>
/**
 * Wikipedia Social Share Gadget
 * Adds social sharing features:
 *   1. A persistent share button in the toolbar/page
 *   2. A contextual popup when text is selected
 *
 * Uses the Web Share API to share a generated image (canvas-based),
 * article URL, and title or selected text. Also offers to just copy
 * the image to the clipboard.
 */
/* global mw, $, mediaWiki */

( function () {
	'use strict';

	// Only run in article namespace
	if ( mw.config.get( 'wgNamespaceNumber' ) !== 0 ) return;

	const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><!----><g><path d="M3 3h8v2h2V3c0-1.1-.895-2-2-2H3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h2v-2H3z"></path><path d="M9 9h8v8H9zm0-2c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2h8c1.1 0 2-.895 2-2V9c0-1.1-.895-2-2-2z"></path></g></svg>';
	const shareIcon = '<svg xmlns="http://www.w3.org/2000/svg" stroke="currentColor" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><!----><g><path d="M12 6V2l7 7-7 7v-4c-5 0-8.5 1.5-11 5l.8-3 .2-.4A12 12 0 0112 6"></path></g></svg>';
	const legacyBrandColors = [ '#339966', '#0063BF', '#990000' ];
	const randomLegacyColor = () => legacyBrandColors[ Math.floor(Math.random() * legacyBrandColors.length) ];

	function fetchImage( src ) {
		return new Promise( ( resolve ) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = function () { resolve( img ); };
			img.onerror = function () { resolve( null ); };
			img.src = src;
		} );
	}

	/**
	 * Fetch the best thumbnail for the current article via the MW API.
	 * Resolves with an HTMLImageElement (CORS-enabled) or null on failure.
	 */
	function fetchArticleImage() {
		const title = mw.config.get( 'wgTitle' );
		return new mw.Api().get( {
			action: 'query',
			titles: title,
			prop: 'pageimages',
			piprop: 'thumbnail',
			pithumbsize: 600,
			format: 'json',
			origin: '*'
		} ).then( function ( data ) {
			const pages = data && data.query && data.query.pages;
			if ( !pages ) {
				return null;
			}
			const page = Object.values( pages )[ 0 ];
			const src = page && page.thumbnail && page.thumbnail.source;
			if ( !src ) {
				return null;
			}
			return fetchImage( src );
		} ).catch( function () { return null; } );
	}

	function fetchLogoImage() {
		// const logo = document.querySelector( '.mw-logo img.mw-logo-icon' );
		const logo = document.querySelector( '.mw-logo img.mw-logo-wordmark' );
		if ( logo ) {
			return new Promise( ( resolve ) => { resolve( logo ) } );
		}
	}

	function addStyle( element, styles ) {
		Object.assign( element.style, styles );
	}

	function drawOutlinedText( ctx, text, x, y ) {
		ctx.save();
		ctx.strokeStyle = 'black';
		ctx.fillStyle = 'white';
		ctx.lineWidth = 4;
		ctx.lineJoin = 'round';
		ctx.miterLimit = 2;
		ctx.strokeText( text, x, y );
		ctx.fillText( text, x, y );
		ctx.restore();
	}

	function drawPlainText( ctx, text, x, y ) {
		ctx.fillText( text, x, y );
	}

	/**
	 * Draw word-wrapped text onto a canvas context.
	 *
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {string} text
	 * @param {number} x Left edge of the text block
	 * @param {number} y Baseline of the first line
	 * @param {number} maxWidth Maximum line width in pixels
	 * @param {number} lineHeight Vertical distance between baselines
	 * @returns {number} Total height of drawn lines
	 */
	function drawWrappedText( ctx, text, x, y, maxWidth, lineHeight, maxHeight = Infinity, drawText = drawPlainText ) {
		if ( lineHeight > maxHeight ) {
			return;
		}

		const words = text.split( ' ' );
		const lines = [];
		let line = '';

		// Work out what the lines are:
		for ( const word of words ) {
			const candidate = line ? line + ' ' + word : word;
			if ( ctx.measureText( candidate ).width <= maxWidth ) {
				line = candidate;
			} else {
				if ( line ) {
					lines.push(line);
				}
				line = word;
			}
		}
		if ( line ) {
			lines.push(line);
		}

		// Cut down the number of lines if we need to, but always output at least one line
		if ( lines.length > 1 && lines.length * lineHeight > maxHeight ) {
			lines.length = Math.max( 1, Math.floor( maxHeight / lineHeight ) );
			// the final line needs to be trimmed to show it was cut off
			let lastLine = lines.pop();
			while ( lastLine && ctx.measureText(lastLine + '\u2026' ).width > maxWidth) {
				lastLine = lastLine.slice( 0, lastLine.lastIndexOf( ' ' ) );
			}
			lines.push( lastLine.replace(/[\.,?!]*$/, '') + '\u2026' );
		}

		// Finally draw the lines
		ctx.save();
		// textBaseline is inconsistent between browsers. textBaseline=top is
		// most consistent with what we're doing, but Safari renders the text
		// noticeably further down with it.
		ctx.textBaseline = 'alphabetic';
		let currentY = y + lineHeight;
		for ( line of lines ) {
			drawText( ctx, line, x, currentY );
			currentY += lineHeight;
		}

		ctx.restore();
		return lines.length * lineHeight;
	}

	/**
	 * Draw the share card onto a canvas synchronously.
	 * @param {string} bodyText selected text or article excerpt
	 * @param {HTMLImageElement|null} articleImage
	 * @param {HTMLImageElement|null} logoImage
	 * @param {boolean} wide Whether to be a wide image
	 * @returns {HTMLCanvasElement}
	 */
	function drawShareCanvas( bodyText, articleImage, logoImage, wide ) {
		const W = wide ? 1200 : 630, H = 630;
		const canvas = document.createElement( 'canvas' );
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext( '2d' );
		ctx.textRendering = 'optimizeLegibility';

		const titleFont = ( size = 44 ) => `normal ${size}px 'Linux Libertine','Georgia','Times','Source Serif 4',serif`;

		const logoFitHeight = 40
		const MARGIN = 36;

		// Background
		ctx.fillStyle = '#ffffff';
		ctx.fillRect( 0, 0, W, H );

		// Left accent strip, random legacy brand color
		ctx.fillStyle = randomLegacyColor();
		ctx.fillRect( 0, 0, 14, H );

		// Image panel (right 40%)
		const imgPanelX = wide ? Math.round( W * 0.58 ) : 14;
		const imgPanelW = W - imgPanelX;
		const imgPanelY = wide ? 0 : ( 16 + logoFitHeight + 4 );
		const imgPanelH = H - imgPanelY;

		if ( articleImage ) {
			// Cover-fit image into right panel
			const scale = Math.max( imgPanelW / articleImage.width, H / articleImage.height );
			const sw = imgPanelW / scale;
			const sh = imgPanelH / scale;
			const sx = ( articleImage.width - sw ) / 2;
			const sy = ( articleImage.height - sh ) / 2;

			ctx.save();
			ctx.beginPath();
			ctx.rect( imgPanelX, imgPanelY, imgPanelW, imgPanelH );
			ctx.clip();
			ctx.drawImage( articleImage, sx, sy, sw, sh, imgPanelX, imgPanelY, imgPanelW, imgPanelH );
			ctx.restore();
		}

		// Logo in top-left
		if ( logoImage ) {
			const scale = logoFitHeight / logoImage.height;
			ctx.drawImage( logoImage, 20, 16, logoImage.width * scale, logoImage.height * scale );
		} else {
			// placeholder circle or suchlike? this is probably an unusual case anyway...
			ctx.fillStyle = '#000000'; // black
			ctx.font = titleFont( 36 );
			ctx.fillText( 'Wikipedia', 20, 46 );
		}

		let cursor = 70;

		ctx.strokeStyle = 'white';

		const drawText = ( wide && articleImage ) ? drawPlainText : drawOutlinedText;

		// Article title
		const title = mw.config.get( 'wgTitle' );
		ctx.fillStyle = '#000000';
		ctx.font = titleFont();
		const textAreaW = ( ( articleImage && wide ) ? imgPanelX : W ) - MARGIN - MARGIN;

		// Shrink font if title is long
		let attemptedSize = 44;
		while ( ctx.measureText( title ).width > textAreaW && attemptedSize > 24 ) {
			attemptedSize -= 2;
			ctx.font = titleFont( attemptedSize );
		}
		cursor += drawWrappedText( ctx, title, MARGIN, cursor, textAreaW, attemptedSize, undefined, drawText );

		// Divider
		cursor += 10;
		// ctx.fillStyle = randomLegacyColor();
		ctx.fillStyle = '#7F7F7F'; // black50
		ctx.fillRect( MARGIN, cursor, textAreaW, 2 );
		cursor += 12;

		// Opening quote mark
		ctx.fillStyle = randomLegacyColor();
		ctx.font = titleFont( 72 );
		ctx.globalAlpha = 0.33;
		ctx.fillText( '\u201c', 26, cursor + 60 );
		ctx.globalAlpha = 1;

		// Article text
		ctx.fillStyle = '#000000'; // black
		ctx.font = '26px sans-serif';
		drawWrappedText( ctx, bodyText, MARGIN, cursor, textAreaW, 34, 450, drawText );

		// Footer
		const articleUrl = location.origin + mw.util.getUrl( title );
		ctx.fillStyle = '#7F7F7F'; // black50
		ctx.textAlign = 'right';
		ctx.font = '18px sans-serif';
		drawText( ctx, articleUrl, textAreaW + MARGIN, H - 16 );

		return canvas;
	}

	/**
	 * Convert a canvas to a PNG Blob.
	 * @param {HTMLCanvasElement} canvas
	 * @returns {Promise<Blob>}
	 */
	function canvasToBlob( canvas ) {
		return new Promise( function ( resolve, reject ) {
			canvas.toBlob( function ( blob ) {
				if ( blob ) {
					resolve( blob );
				} else {
					reject( new Error( 'Canvas toBlob failed' ) );
				}
			}, 'image/png' );
		} );
	}

	/**
	 * Convert a Blob to an image
	 * @param {Blob} canvas
	 * @returns {Promise<HTMLImageElement>}
	 */
	function blobToImage( blob ) {
		return new Promise( ( resolve, reject ) => {
			const url = URL.createObjectURL( blob );
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL( url );
				resolve(img);
			};
			img.onerror = () => {
				URL.revokeObjectURL( url );
				reject( new Error( 'Failed to load image from blob' ) );
			};
			img.src = url;
		} );
	}

	/**
	 * Get a plain-text excerpt from the article's lead paragraph.
	 */
	function getArticleExcerpt() {
		const paras = document.querySelectorAll( '#mw-content-text .mw-parser-output > p, #mw-content-text section > p' );
		for ( const p of paras ) {
			const text = p.textContent.trim();
			if ( text.length > 80 ) {
				return text;
			}
		}
		return mw.config.get( 'wgTitle' );
	}

	function scaleElement( element ) {
		// Scale canvas to fit within the viewport while keeping proportions
		// Canvas is 1200×630; display at a sensible screen size
		const maxW = Math.min( window.innerWidth * 0.85, 800 );
		const maxH = window.innerHeight * 0.65;
		const scale = Math.min( maxW / element.width, maxH / element.height );
		const dispW = Math.round( element.width * scale );
		const dispH = Math.round( element.height * scale );

		addStyle( element, {
			width: dispW + 'px',
			height: dispH + 'px',
			borderRadius: '4px',
			border: '1px solid #eaecf0',
			display: 'block'
		} );

		return element;
	}

	/**
	 * Show our modal with a preview image and share buttons
	 */
	async function doShare( selectedText ) {
		const bodyText = ( selectedText && selectedText.trim().length > 10 )
			? selectedText.trim()
			: getArticleExcerpt();

		// Show the preview modal (starts in loading state)
		getShareDialog().buildShareImage(
			bodyText,
			await fetchArticleImage(),
			await fetchLogoImage()
		);
	}

	// Preview modal
	let dialog
	function getShareDialog( bodyText, articleImage, logoImage ) {
		// Inject keyframe animation once
		if ( !document.getElementById( 'mw-share-spin-style' ) ) {
			const style = document.createElement( 'style' );
			style.id = 'mw-share-spin-style';
			style.textContent = '@keyframes mw-share-spin{to{transform:rotate(360deg)}}';
			document.head.appendChild( style );

			dialog = document.createElement( 'dialog' );
			dialog.closedBy = 'any';
			addStyle( dialog, {
				background: '#fff',
				border: '1px solid #a2a9b1',
				borderRadius: '8px',
				boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
				padding: '20px',
				maxWidth: '90vw',
				maxHeight: '90vh',
			} );

			const close = document.createElement( 'button' );
			close.innerText = 'X';
			addStyle( close, {
				position: 'absolute',
				top: '0', right: '0'
			} );
			close.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				dialog.close();
			} )
			dialog.appendChild( close );

			document.body.appendChild( dialog );

			// Loading state (shown first)
			const loadingRow = document.createElement( 'div' );
			addStyle( loadingRow, {
				display: 'flex', alignItems: 'center', gap: '12px',
				fontSize: '15px', color: '#202122',
				padding: '12px 0'
			} );
			loadingRow.innerHTML =
				'<span style="display:inline-block;width:20px;height:20px;'
				+ 'border:3px solid #3366cc;border-top-color:transparent;'
				+ 'border-radius:50%;animation:mw-share-spin 0.7s linear infinite;'
				+ 'flex-shrink:0"></span>'
				+ ' Preparing image\u2026';
			dialog.appendChild( loadingRow );

			const content = document.createElement( 'div' );
			addStyle( content, {
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: '14px',
				overflow: 'hidden'
			} );
			content.style.display = 'none';

			// Label
			const label = document.createElement( 'p' );
			addStyle( label, {
				margin: '0',
				fontSize: '13px',
				color: '#54595d',
				alignSelf: 'flex-start'
			} );
			label.textContent = 'Image to be shared: ';
			[ [ 'Square', false ], [ 'Wide', true ] ].forEach( ( [ mode, modeArg ] ) => {
				const action = document.createElement( 'button' );
				action.textContent = mode;
				action.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					e.preventDefault();
					dialog.buildShareImage( dialog.data.bodyText, dialog.data.articleImage, dialog.data.logoImage, modeArg );
				} );
				label.appendChild( action );
			} );
			content.appendChild( label );
			const imageContainer = document.createElement( 'div' );
			content.appendChild( imageContainer );

			const buttons = document.createElement( 'div' );
			content.appendChild( buttons );

			dialog.appendChild( content );

			dialog.buildShareImage = async ( bodyText, articleImage, logoImage, wide ) => {
				dialog.data = { bodyText, articleImage, logoImage };

				loadingRow.style.display = '';
				const canvas = drawShareCanvas( bodyText, articleImage, logoImage, wide );
				loadingRow.style.display = 'none';

				content.style.display = 'flex';

				imageContainer.innerHTML = '';
				scaleElement( canvas );
				imageContainer.appendChild( canvas );

				// Convert to Blob (slightly async) in parallel with the user
				// reading the preview
				const imageBlob = await canvasToBlob( canvas );
				const newImg = await blobToImage( imageBlob );

				canvas.replaceWith( scaleElement( newImg ) );

				dialog.showShareButtons(
					mw.config.get( 'wgTitle' ),
					location.origin + mw.util.getUrl( mw.config.get( 'wgTitle' ) ),
					bodyText,
					imageBlob
				);
			}

			dialog.showShareButtons = async ( title, url, text, imageBlob ) => {
				buttons.innerHTML = '';

				const copyButton = document.createElement( 'button' );
				copyButton.innerHTML = copyIcon + ' Copy this image';
				copyButton.addEventListener( 'click', async ( e ) => {
					e.preventDefault();
					const clipboardItem = new ClipboardItem( {
						[ imageBlob.type ]: imageBlob
					} );
					await navigator.clipboard.write( [ clipboardItem ] );
					mw.notify( 'Copied image to the clipboard' );
				} );
				buttons.appendChild( copyButton );
				if ( navigator.share ) {
					const shareButton = document.createElement( 'button' );
					shareButton.innerHTML = shareIcon + ' Share this image';
					shareButton.addEventListener( 'click', async ( e ) => {
						e.stopPropagation();
						e.preventDefault();
						try {
							const shareData = { title, url, text, files: [ new File( [ imageBlob ], 'wikipedia-share.png', { type: 'image/png' } ) ] };
							// Fall back gracefully if file sharing isn't supported
							if ( !( navigator.canShare && navigator.canShare( shareData ) ) ) {
								delete shareData.files;
							}
							await navigator.share( shareData );
						} catch ( e ) {
							if ( e.name !== 'AbortError' ) {
								mw.notify( 'Could not share: ' + e.message, { type: 'error' } );
							}
						}
					} );
					buttons.appendChild( shareButton );
				}
			}
		}

		dialog.showModal();

		return dialog;
	}

	// Persistent share link

	function addPageShareButton() {
		var node = mw.util.addPortletLink(
			'p-cactions',
			'#',
			'Share',
			'mw-share-page-link',
			'Share this article'
		);
		if ( node ) {
			node.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				doShare();
			} );
			// .find( 'a' ).prepend( $( shareIcon ) );
		}

		const mobileOverflow = document.querySelector( '#page-actions-overflow .page-actions-overflow-list' );
		if ( mobileOverflow ) {
			const item = document.createElement( 'li' );
			item.classList.add( 'toggle-list-item' );
			const link = document.createElement( 'a' );
			link.classList.add( 'toggle-list-item__anchor' );
			link.href = '#';
			// link.innerText = 'Share';
			link.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				doShare();
			} );
			const icon = document.createElement( 'span' );
			icon.classList.add( 'minerva-icon', 'minerva-icon--share' );
			const text = document.createElement( 'span' );
			text.classList.add( 'toggle-list-item__label' );
			text.innerText = 'Share',

			link.appendChild( icon );
			link.appendChild( text );
			item.appendChild( link );
			mobileOverflow.appendChild( item );
		}
	}

	// Selection-based contextual popup

	let selectionPopup = null;

	function removeSelectionPopup() {
		if ( selectionPopup ) {
			selectionPopup.remove();
			selectionPopup = null;
		}
	}

	function createSelectionPopup( text, centerX, topY ) {
		removeSelectionPopup();

		const popup = document.createElement( 'div' );
		popup.id = 'mw-share-selection-popup';

		addStyle( popup, {
			position: 'absolute',
			zIndex: 9998,
			background: '#202122',
			color: '#fff',
			borderRadius: '4px',
			padding: '6px 10px',
			fontSize: '13px',
			display: 'flex', alignItems: 'center', gap: '8px',
			boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
			whiteSpace: 'nowrap',
			userSelect: 'none',
			cursor: 'pointer',
			pointerEvents: 'auto'
		} );

		// Tiny caret / tooltip arrow
		const arrow = document.createElement( 'span' );
		addStyle( arrow, {
			position: 'absolute',
			bottom: '-6px',
			left: '50%',
			transform: 'translateX(-50%)',
			width: 0, height: 0,
			borderLeft: '6px solid transparent',
			borderRight: '6px solid transparent',
			borderTop: '6px solid #202122'
		} );
		popup.appendChild( arrow );

		popup.innerHTML += shareIcon + '<span>Share selection</span>';

		popup.addEventListener( 'mousedown', function ( e ) {
			// Prevent this click from clearing the selection
			e.preventDefault();
		} );
		popup.addEventListener( 'click', function () {
			doShare( text );
			removeSelectionPopup();
		} );

		document.body.appendChild( popup );

		const scrollX = window.scrollX || window.pageXOffset;
		const scrollY = window.scrollY || window.pageYOffset;
		const popupWidth = popup.getBoundingClientRect().width;
		const popupHeight = popup.getBoundingClientRect().height;
		const gap = 8; // px between popup bottom and selection top

		// Center horizontally on the selection, clamp to viewport
		let left = centerX - popupWidth / 2;
		left = Math.max( 8, Math.min( left, window.innerWidth - popupWidth - 8 ) );

		popup.style.left = ( left + scrollX ) + 'px';
		popup.style.top = ( topY + scrollY - popupHeight - gap ) + 'px';

		selectionPopup = popup;
	}

	function showPopup() {
		const sel = window.getSelection();
		const text = sel ? sel.toString() : '';

		if ( !text || text.trim().length < 10 ) {
			return removeSelectionPopup();
		}

		// Only react to selections inside the article body
		const contentArea = document.getElementById( 'mw-content-text' );
		if ( !contentArea || !contentArea.contains( sel.anchorNode ) ) {
			return removeSelectionPopup();
		}

		// Position popup above the selection
		try {
			const range = sel.getRangeAt( 0 );
			const boundingRect = range.getBoundingClientRect();
			const firstRect = range.getClientRects()[ 0 ];
			if ( !boundingRect || !firstRect ) {
				return removeSelectionPopup();
			}

			createSelectionPopup(
				text,
				boundingRect.left + boundingRect.width / 2, // center X of whole selection
				firstRect.top // top of first line
			);
		} catch ( err ) {
			removeSelectionPopup();
		}
	}

	function init() {
		mw.loader.enqueue( [ 'mediawiki.api', 'mediawiki.util', 'mediawiki.notification' ], () => {
			// mouseup rather than selectionchange to avoid showing it while someone is dragging
			document.addEventListener( 'selectionchange', mw.util.debounce( showPopup, 250 ) );

			// Hide popup on scroll / new click elsewhere
			document.addEventListener( 'mousedown', function ( e ) {
				if ( selectionPopup && !selectionPopup.contains( e.target ) ) {
					removeSelectionPopup();
				}
			} );
			document.addEventListener( 'scroll', removeSelectionPopup, { passive: true } );
			document.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Escape' ) removeSelectionPopup();
			} );

			addPageShareButton();
		} );
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}

}() );
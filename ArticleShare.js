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
	function drawWrappedText( ctx, text, x, y, maxWidth, lineHeight, maxHeight = Infinity ) {
		if ( lineHeight > maxHeight ) {
			return;
		}
		ctx.save();
		// Needed or the return is meaningless:
		ctx.textBaseline = 'top';

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

		// Cut down the number of lines if we need to:
		let truncated;
		while ( ( lines.length * lineHeight ) > maxHeight ) {
			truncated = lines.pop();
		}
		if ( truncated ) {
			// truncate the final line
			while ( truncated && ctx.measureText(truncated + '\u2026' ).width > maxWidth) {
				truncated = truncated.slice( 0, truncated.lastIndexOf( ' ' ) );
			}
			lines.push( truncated.replace(/[\.,?!]*$/, '') + '\u2026' );
		}

		// Finally draw the lines
		let currentY = y;
		for ( line of lines ) {
			ctx.fillText( line, x, currentY );
			currentY += lineHeight;
		}

		ctx.restore();
		return lines.length * lineHeight;
	}

	/**
	 * Draw the share card onto a canvas synchronously.
	 * @param {string} bodyText  – selected text or article excerpt
	 * @param {HTMLImageElement|null} articleImage
	 * @param {HTMLImageElement|null} logoImage
	 * @returns {HTMLCanvasElement}
	 */
	function drawShareCanvas( bodyText, articleImage, logoImage ) {
		const W = 1200, H = 630;
		const canvas = document.createElement( 'canvas' );
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext( '2d' );

		const titleFont = ( size = 44 ) => `bold ${size}px 'Linux Libertine','Georgia','Times','Source Serif 4',serif`;

		// Background
		ctx.fillStyle = '#ffffff';
		ctx.fillRect( 0, 0, W, H );

		// Left accent strip, random legacy brand color
		ctx.fillStyle = randomLegacyColor();
		ctx.fillRect( 0, 0, 14, H );

		// Image panel (right 40%)
		const imgPanelX = Math.round( W * 0.58 );
		const imgPanelW = W - imgPanelX;

		if ( articleImage ) {
			// Cover-fit image into right panel
			const scale = Math.max( imgPanelW / articleImage.width, H / articleImage.height );
			const sw = imgPanelW / scale;
			const sh = H / scale;
			const sx = ( articleImage.width - sw ) / 2;
			const sy = ( articleImage.height - sh ) / 2;

			ctx.save();
			ctx.beginPath();
			ctx.rect( imgPanelX, 0, imgPanelW, H );
			ctx.clip();
			ctx.drawImage( articleImage, sx, sy, sw, sh, imgPanelX, 0, imgPanelW, H );
			ctx.restore();
		}

		// Logo in top-left
		if ( logoImage ) {
			const fitToHeight = 40
			const scale = fitToHeight / logoImage.height;
			ctx.drawImage( logoImage, 16, 16, logoImage.width * scale, logoImage.height * scale );
		} else {
			// placeholder circle or suchlike? this is probably an unusual case anyway...
			ctx.fillStyle = '#000000'; // black
			ctx.font = titleFont( 22 );
			ctx.fillText( 'Wikipedia', 36, 46 );
		}

		let cursor = 70;

		// Article title
		const title = mw.config.get( 'wgTitle' );
		ctx.fillStyle = '#000000';
		ctx.font = titleFont();
		const textAreaW = ( articleImage ? imgPanelX : W ) - 36 - 36;

		// Shrink font if title is long
		let attemptedSize = 44;
		while ( ctx.measureText( title ).width > textAreaW && attemptedSize > 24 ) {
			attemptedSize -= 2;
			ctx.font = titleFont( attemptedSize );
		}
		cursor += drawWrappedText( ctx, title, 36, cursor, textAreaW, attemptedSize );

		// Divider
		cursor += 10;
		// ctx.fillStyle = randomLegacyColor();
		ctx.fillStyle = '#7F7F7F'; // black50
		ctx.fillRect( 36, cursor, textAreaW, 2 );
		cursor += 22;

		// Opening quote mark
		ctx.fillStyle = randomLegacyColor();
		ctx.font = titleFont( 72 );
		ctx.globalAlpha = 0.25;
		ctx.fillText( '\u201c', 26, cursor + 44 );
		ctx.globalAlpha = 1;

		ctx.fillStyle = '#000000'; // black
		ctx.font = '24px sans-serif';
		drawWrappedText( ctx, bodyText, 36, cursor, textAreaW, 34, 450 );

		// Footer
		const articleUrl = location.origin + mw.util.getUrl( title );
		ctx.fillStyle = '#7F7F7F'; // black50
		ctx.font = '18px sans-serif';
		ctx.fillText( articleUrl, 36, H - 6 );

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
		const paras = document.querySelectorAll( '#mw-content-text .mw-parser-output > p' );
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
	 * Trigger the Web Share sheet with a generated image, URL, and title.
	 */
	async function doShare( selectedText ) {
		const bodyText = ( selectedText && selectedText.trim().length > 10 )
			? selectedText.trim()
			: getArticleExcerpt();

		// Show the preview modal (starts in loading state)
		const modal = createPreviewModal();
		document.body.appendChild( modal );

		// Fetch image first, then draw canvas synchronously so preview
		// appears as soon as pixels are ready — before toBlob() runs.
		const articleImage = await fetchArticleImage();
		const logoImage = await fetchLogoImage();
		const canvas = drawShareCanvas( bodyText, articleImage, logoImage );

		// Swap spinner for the rendered canvas preview
		modal.showCanvas( canvas );

		// Convert to Blob (slightly async) in parallel with the user
		// reading the preview
		const imageBlob = await canvasToBlob( canvas );

		const newImg = await blobToImage( imageBlob );
		canvas.replaceWith( scaleElement( newImg ) );

		modal.showShareButtons( mw.config.get( 'wgTitle' ), location.href, imageBlob );
	}

	// Preview modal

	function createPreviewModal() {
		// Inject keyframe animation once
		if ( !document.getElementById( 'mw-share-spin-style' ) ) {
			const style = document.createElement( 'style' );
			style.id = 'mw-share-spin-style';
			style.textContent = '@keyframes mw-share-spin{to{transform:rotate(360deg)}}';
			document.head.appendChild( style );
		}

		// Card
		const card = document.createElement( 'div' );
		addStyle( card, {
			background: '#fff',
			border: '1px solid #a2a9b1',
			borderRadius: '8px',
			boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
			padding: '20px',
			maxWidth: '90vw',
			maxHeight: '90vh',
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			gap: '14px',
			overflow: 'hidden'
		} );

		// Backdrop
		const backdrop = document.createElement( 'div' );
		backdrop.id = 'mw-share-modal-backdrop';
		addStyle( backdrop, {
			position: 'fixed', inset: '0',
			background: 'rgba(0,0,0,0.45)',
			zIndex: 9998,
			display: 'flex', alignItems: 'center', justifyContent: 'center'
		} );

		backdrop.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			if ( !card.contains( e.target ) ) {
				backdrop.remove();
			}
		} );

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
			+ ' Preparing share\u2026';
		card.appendChild( loadingRow );

		backdrop.appendChild( card );

		// API: swap loading indicator for the canvas preview
		backdrop.showCanvas = ( canvas ) => {
			// Remove loading row
			loadingRow.remove();

			// Label
			const label = document.createElement( 'p' );
			addStyle( label, {
				margin: '0',
				fontSize: '13px',
				color: '#54595d',
				alignSelf: 'flex-start'
			} );
			label.textContent = 'Image to be shared:';
			card.appendChild( label );

			scaleElement( canvas );

			card.appendChild( canvas );
		};

		backdrop.showShareButtons = async ( title, url, imageBlob ) => {
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
			card.appendChild( copyButton );
			if ( !navigator.share ) {
				return;
			}
			const shareButton = document.createElement( 'button' );
			shareButton.innerHTML = shareIcon + ' Share this image';
			shareButton.addEventListener( 'click', async ( e ) => {
				e.preventDefault();
				try {
					const shareData = { title, url, files: [ new File( [ imageBlob ], 'wikipedia-share.png', { type: 'image/png' } ) ] };
					// Fall back gracefully if file sharing isn't supported
					if ( !( navigator.canShare && navigator.canShare( shareData ) ) ) {
						delete shareData.files;
					}
					await navigator.share( shareData );
				} catch ( e ) {
					if ( e.name !== 'AbortError' ) {
						mw.notify( 'Could not share: ' + e.message, { type: 'error' } );
					}
				} finally {
					backdrop.remove();
				}
			} );
			card.appendChild( shareButton );
		}

		return backdrop;
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
		$( node ).on( 'click', function ( e ) {
			e.preventDefault();
			doShare();
		} );
		// .find( 'a' ).prepend( $( shareIcon ) );
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
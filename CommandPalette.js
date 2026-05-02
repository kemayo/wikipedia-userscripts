( function () {

'use strict';

// Menu item setup

const ITEMS = [
	// e.g.
	// { label: 'Action', action: () => console.log('action happened') },
];

function inductPortlet( portlet, prefix, itemSelector = '.mw-list-item a' ) {
	if ( !portlet ) {
		return;
	}
	if ( Array.isArray( portlet ) || portlet instanceof NodeList ) {
		portlet.forEach( ( portlet2 ) => {
			inductPortlet( portlet2, prefix );
		} );
		return;
	}
	if ( prefix instanceof Function ) {
		prefix = prefix( portlet );
	}
	prefix = prefix ? ( prefix + ': ' ) : '';

	portlet.querySelectorAll( itemSelector ).forEach( ( link ) => {
		if ( !link.textContent ) {
			return;
		}
		ITEMS.push( {
			label: prefix + link.textContent.trim().replace( /\s+/, ' ' ),
			action: () => link.click(),
		} );
	} );
}

// TODO: non-vector skins
inductPortlet( document.querySelector( 'nav.vector-user-links .vector-user-links-main' ), ( p ) => p.parentElement.getAttribute( 'aria-label' ) );
inductPortlet( document.querySelector( '#p-personal' ), ( p ) => p.getAttribute( 'title' ), undefined, true );
inductPortlet( document.querySelector( '#p-views' ), ( p ) => p.parentElement.getAttribute( 'aria-label' ) );
inductPortlet( document.querySelectorAll( '#vector-page-tools .mw-portlet' ), ( p ) => p.querySelector( '.vector-menu-heading' ).textContent );
inductPortlet( document.querySelector( '#vector-toc' ), ( p ) => p.querySelector( 'h2' ).textContent, 'li > a' );

// Palette

let menuEl = null;
let inputEl = null;
let listEl = null;
let activeIndex = 0;

function getFilteredItems( query ) {
	const q = query.trim().toLowerCase();
	if (!q) {
		return ITEMS;
	}
	// Simple substring search:
	// return ITEMS.filter( ( item ) => item.label.toLowerCase().includes( q ) );

	// Fancy search
	const re = new RegExp( q.split( '' ).join( '.*' ), 'ig' );
	return ITEMS.filter( ( item ) => item.label.match( re ) );
}

function renderItems( items ) {
	listEl.innerHTML = '';
	activeIndex = 0;

	for (let i = 0; i < items.length; i++) {
		const row = document.createElement('div');
		row.className = 'palette-item';
		row.textContent = items[i].label;
		row.dataset.index = i;
		row.style.cssText = 'padding: 6px 16px; cursor: pointer;';
		row.addEventListener('mouseenter', () => setActive(i));
		row.addEventListener('click', () => { items[i].action(); closeMenu(); });
		listEl.appendChild(row);
	}

	setActive(0);
}

function setActive( index ) {
	const rows = listEl.querySelectorAll( '.palette-item' );
	if (!rows.length) {
		return;
	}
	activeIndex = Math.max( 0, Math.min( index, rows.length - 1 ) );
	rows.forEach( ( row, i ) => {
		row.style.background = i === activeIndex ? '#f0f0f0' : '';
	} );
	rows[activeIndex].scrollIntoView( { block: 'nearest' } );
}

function runActive( items ) {
	const rows = listEl.querySelectorAll( '.palette-item' );
	if ( !rows.length ) {
		return;
	}
	items[ activeIndex ].action();
	closeMenu();
}

function buildMenu() {
	const el = document.createElement( 'div' );
	el.style.cssText = [
		'position: fixed',
		'top: 20%',
		'left: 50%',
		'transform: translateX(-50%)',
		'background: #fff',
		'border: 1px solid #ccc',
		'border-radius: 6px',
		'box-shadow: 0 4px 24px rgba(0,0,0,0.18)',
		'z-index: 2147483647',
		'min-width: 320px',
		'font: 14px/1.5 system-ui, sans-serif',
		'overflow: hidden',
	].join( '; ' );

	inputEl = document.createElement( 'input' );
	inputEl.type = 'text';
	inputEl.placeholder = 'Search commands...';
	inputEl.style.cssText = [
		'display: block',
		'width: 100%',
		'box-sizing: border-box',
		'padding: 10px 16px',
		'border: none',
		'border-bottom: 1px solid #eee',
		'font: inherit',
		'outline: none',
	].join( '; ' );

	listEl = document.createElement( 'div' );
	listEl.style.cssText = 'max-height: 240px; overflow-y: auto;';

	let currentItems = ITEMS;

	inputEl.addEventListener( 'input', () => {
		currentItems = getFilteredItems( inputEl.value );
		renderItems( currentItems );
	} );

	inputEl.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'ArrowDown' ) {
			e.preventDefault();
			setActive( activeIndex + 1 );
		} else if ( e.key === 'ArrowUp' ) {
			e.preventDefault();
			setActive( activeIndex - 1 );
		} else if ( e.key === 'Enter' ) {
			e.preventDefault();
			runActive( currentItems );
		} else if ( e.key === 'Escape' ) {
			closeMenu();
		}
	} );

	el.appendChild( inputEl );
	el.appendChild( listEl );

	renderItems( ITEMS );
	return el;
}

function openMenu() {
	if ( menuEl ) {
		return;
	}
	menuEl = buildMenu();
	document.body.appendChild( menuEl );
	inputEl.focus();
}

function closeMenu() {
	if ( !menuEl ) {
		return;
	}
	menuEl.remove();
	menuEl = null;
	inputEl = null;
	listEl = null;
}

// Listeners

document.addEventListener( 'keydown', ( e ) => {
	if ( e.key === 'p' && e.shiftKey && ( e.metaKey || e.ctrlKey ) ) {
		if ( document.documentElement.classList.contains( 've-active' ) ) {
			// VisualEditor also has a command palette on this shortcut
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		menuEl ? closeMenu() : openMenu();
	}
}, true );

document.addEventListener( 'mousedown', (e) => {
	if ( menuEl && !menuEl.contains(e.target) ) {
		closeMenu();
	}
}, true );

} )();
( function () {
'use strict';

// Map of normalized template titles -> { paramName: { ...overrides } }.
// - Keys must be the full prefixed, normalized title as VE sees it:
//   "Template:" prefix, spaces (not underscores), first letter capitalized.
// - Values are merged into each parameter's TemplateData object, so besides
//   `suggested` you can override other TemplateData fields (label, description,
//   autovalue, example, type, etc.) for that param.
const TEMPLATE_PARAM_OVERRIDES = {
	'Template:Cite web': {
		language: { suggested: true },
		"trans-title": { suggested: true }
	}
};

mw.hook( 've.newTarget' ).add( function () {
	const Cache = ve.getProp( ve, 'init', 'mw', 'TemplateDataCache' );
	// Bail if VE structure isn't what we expect, or we've already patched.
	if ( ve.getProp( Cache, 'static', 'suggestedOverridePatched' ) ) {
		return;
	}

	const orig = Cache.static.processPage;
	Cache.static.processPage = function ( page ) {
		// Run VE's own processing first
		page = orig ? orig.call( this, page ) : page;

		var overrides = page && page.title && TEMPLATE_PARAM_OVERRIDES[ page.title ];
		// console.log('processPage', page, overrides);
		if ( overrides ) {
			page.params = page.params || {};
			for ( var name in overrides ) {
				// Deep-apply overrides (creating the param entirely if it doesn't exist...)
				page.params[ name ] = ve.extendObject(
					true, {}, page.params[ name ], overrides[ name ]
				);
			}
		}
		return page;
	};

	Cache.static.suggestedOverridePatched = true;
} );
}() );
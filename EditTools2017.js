mw.hook( 've.activationComplete' ).add( function () {
	( new mw.Api().parse( mw.Title.newFromText( 'MediaWiki:edittools' ) ) ).then( function ( edittools ) {
		if ( !edittools ) {
			console.log( 'edittools2017: no edit tools message' );
			return;
		}
		var replacements = {};
		$( edittools ).find( '[data-section-title]:first > .mw-charinsert-item' ).each( function (i, elem) {
			var $tool = $( elem );
			replacements[ $tool.text() ] = {
				source: true,
				action: {
					label: $tool.text(),
					type: 'encapsulate',
					options: {
						pre: $tool.data('mw-charinsert-start'),
						post: $tool.data('mw-charinsert-end'),
					},
				},
			};
		} );
		if ( Object.keys( replacements ).length === 0 ) {
			console.log( 'edittools2017: no edit tools' );
			return;
		}
		var fSCL = ve.init.platform.fetchSpecialCharList;
		ve.init.platform.fetchSpecialCharList = function () {
			var platform = this;
			return fSCL.call( platform ).then( function ( characters ) {
				var newCharacters = {};
				if ( characters ) {
					if ( !characters.other ) {
						// make sure this is at the front if it didn't already exist:
						characters = Object.assign( {
							other: {
								label: mw.msg( 'visualeditor-special-characters-group-other' ),
								symbols: [],
								characters: {},
								attributes: { dir: mw.config.get( 'wgVisualEditorConfig' ).pageLanguageDir }
							},
						}, characters );
					}
					if ( platform.processSpecialCharSymbols ) {
						ve.batchPush( characters.other.symbols, platform.processSpecialCharSymbols( replacements ) );
					} else {
						Object.assign( characters.other.characters, replacements );
					}
				}
				return characters;
			} );
		};
	} );
} );

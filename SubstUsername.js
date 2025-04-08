'use strict';
mw.hook( 've.newTarget' ).add( ( target ) => {
	if ( target.constructor.static.name !== 'article' ) {
		return;
	}
	if ( !mw.libs.ve.isWikitextAvailable ) {
		return;
	}

	const userpage = mw.Title.newFromText( 'User:' + mw.user.getName() ).getPrefixedDb();

	ve.ui.wikitextCommandRegistry.register(
		new ve.ui.Command(
			'substMyUser', 'mwWikitext', 'toggleWrapSelection',
			{ args: [ '{{subst:' + userpage + '/', '}}', '' ], supportedSelections: [ 'linear' ] }
		)
	);
	ve.ui.wikitextSequenceRegistry.register(
		new ve.ui.Sequence( 'substMyUser', 'substMyUser', '!SUB', 4 )
	);
} );

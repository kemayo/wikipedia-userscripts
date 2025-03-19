mw.hook( 've.newTarget' ).add( ( target ) => {
	if ( target.constructor.static.name !== 'discussionTools' ) {
		return;
	}

	// This will run every time a new topic / reply is opened

	if ( !ve.ui.toolFactory.lookup( 'pingAll' ) ) {
		/**
		 * Define all the pieces needed for a toolbar button:
		 * * a Tool, which goes on the toolbar
		 * * an Action, which does the work
		 * * a Command, which connects the Tool and the Action
		 */

		// Tool

		function PingAllTool() {
			// Parent constructor
			PingAllTool.super.apply( this, arguments );
		}

		OO.inheritClass( PingAllTool, ve.ui.Tool );

		PingAllTool.static.commandName = 'insertAllPings';
		PingAllTool.static.name = 'pingAll';
		PingAllTool.static.icon = 'userGroup';
		PingAllTool.static.title = OO.ui.deferMsg( 'discussiontools-replywidget-mention-tool-title' );
		PingAllTool.static.autoAddToCatchall = false;

		PingAllTool.prototype.onUpdateState = function () {
			// Parent method
			PingAllTool.super.prototype.onUpdateState.apply( this, arguments );

			if ( this.isDisabled() ) {
				return;
			}

			const authors = this.toolbar.getSurface() ? this.toolbar.getSurface().authors : [];
			const hasOtherAuthors = authors.some( ( author ) => author.username !== mw.user.getName() );

			this.setDisabled( !hasOtherAuthors );
		};


		ve.ui.toolFactory.register( PingAllTool );

		// Action

		function PingAllAction() {
			PingAllAction.super.apply( this, arguments );

			this.authors = ( this.surface.authors || []).filter( ( author ) => author.username !== mw.user.getName() );
		}

		OO.inheritClass( PingAllAction, ve.ui.Action );

		PingAllAction.static.name = 'pingAll';
		PingAllAction.static.methods = [ 'insert' ];

		PingAllAction.prototype.insert = function () {
			// We're going to be setting the selection ourselves at the end of
			// this, so turning off autoselect avoids unnecessary updates.
			const fragment = this.surface.getModel().getFragment().setAutoSelect( false );
			const content = [];

			this.authors.forEach( ( author, i ) => {
				if ( i > 0 ) {
					content.push( ',', ' ' );
				}
				if ( this.surface.getMode() === 'source' ) {
					// This isn't necessary, as the surface would convert the
					// visual-data version via an API call. However, building
					// the wikitext avoids the delay.
					const prefix = mw.msg( 'discussiontools-replywidget-mention-prefix' ),
						suffix = mw.msg( 'discussiontools-replywidget-mention-suffix' ),
						title = mw.Title.newFromText( author.username, mw.config.get( 'wgNamespaceIds' ).user );
					content.push.apply( content, ( prefix + '[[' + title.getPrefixedText() + '|' + author.username + ']]' + suffix ).split( '' ) );
				} else {
					content.push(
						{ type: 'mwPing', attributes: { user: author.username } },
						{ type: '/mwPing' }
					);
				}
			} );
			if ( content.length > 0 ) {
				fragment.insertContent( content );
				// This is only *really* needed for source mode *if* we remove
				// the wikitext-building above, because the conversion is
				// async. It's good practice in case something else comes up
				// in the future, however.
				fragment.getPending().then( () => {
					fragment.collapseToEnd().select();
					// HACK: The conversion pending dialog in source mode
					// steals focus. Wait for it to close.
					setTimeout( () => {
						this.surface.getView().focus();
					}, 250 );
				} );
				return true;
			}
			return false;
		};

		ve.ui.actionFactory.register( PingAllAction );

		// Command

		const command = new ve.ui.Command(
			// commandName, actionName, actionMethod, restrictions
			'insertAllPings', PingAllAction.static.name, 'insert',
			{ supportedSelections: [ 'linear' ] }
		);
		ve.ui.commandRegistry.register( command );
		ve.ui.wikitextCommandRegistry.register( command );
	}

	// Add to the new target's toolbar
	const addGroup = target.toolbarGroups.find( ( group ) => group.name === 'other' );
	if ( addGroup ) {
		addGroup.include.push( 'pingAll' )
	}

} );

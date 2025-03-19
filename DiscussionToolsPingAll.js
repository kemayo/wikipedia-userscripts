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

			const authors = this.toolbar.getSurface() ? this.toolbar.getSurface().authors : [];

			this.setDisabled( !authors.some( ( author ) => author.username !== mw.user.getName() ) );
		};


		ve.ui.toolFactory.register( PingAllTool );

		// Action

		function PingAllAction() {
			PingAllAction.super.apply( this, arguments );

			this.authors = this.surface.authors.filter( ( author ) => author.username !== mw.user.getName() );
		}

		OO.inheritClass( PingAllAction, ve.ui.Action );

		PingAllAction.static.name = 'pingAll';
		PingAllAction.static.methods = [ 'insert' ];

		PingAllAction.prototype.insert = function () {
			const fragment = this.surface.getModel().getFragment();
			const content = [];

			this.authors.forEach( ( author, i ) => {
				if ( i > 0 ) {
					content.push( ',', ' ' );
				}
				if ( this.surface.getMode() === 'source' ) {
					// This isn't strictly necessary, as the surface would
					// convert the visual-data version via an API call.
					// However, building the wikitext avoids the delay.
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
				fragment.collapseToEnd().select();
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

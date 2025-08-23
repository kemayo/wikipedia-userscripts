mw.hook( 've.newTarget' ).add( ( target ) => {
	if ( ve.ui.sequenceRegistry.lookup( 'codeBacktick' ) ) {
		return;
	}

	function BacktickAction () {
		// Parent constructor
		BacktickAction.super.apply( this, arguments );
	}
	OO.inheritClass( BacktickAction, ve.ui.Action );

	BacktickAction.static.name = 'backtickCode';
	BacktickAction.static.methods = [ 'doTheThing' ];

	BacktickAction.prototype.doTheThing = function() {
		const surfaceModel = this.surface.getModel();
		let fragment = this.surface.getModel().getFragment();

		// strip backticks from the start and end:
		fragment.truncateLinearSelection( -1 ).removeContent();
		fragment.truncateLinearSelection( 1 ).removeContent();

		// annotate what remains:

		ve.dm.CodeAnnotation.static.removes.forEach( ( remove ) => fragment.annotateContent( 'clear', remove ) );
		fragment.annotateContent( 'set', ve.dm.CodeAnnotation.static.name, [] );

		fragment.collapseToEnd().select();

		return true;
	}
	ve.ui.actionFactory.register( BacktickAction );

	ve.ui.commandRegistry.register(
		new ve.ui.Command(
			'codeBacktickApply', 'backtickCode', 'doTheThing'
		)
	);
	ve.ui.sequenceRegistry.register(
		// Only reason I need all of the above is that sequence doesn't let
		// you strip from the front, only the end; otherwise we could just
		// have 'code' as the second argument here.
		// Other useful thing would be a sequence option for only matching
		// against new runs of text. This matches back to previously-entered
		// backticks, which are uncommon, but it's definitely not the ideal
		// behavior.
		new ve.ui.Sequence( 'codeBacktick', 'codeBacktickApply', /`[^`]+`$/, 0, {
			setSelection: true,
			delayed: false,
		} )
	);
} );

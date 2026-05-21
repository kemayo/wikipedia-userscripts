// This could be significantly smarter about trying to match surrounding
// indentation. But right now it's not.

// This is what counts as one indent:
const INDENT = '    '; // 4x spaces
const SELECT = false;

let commandOverridden = false;
mw.hook( 've.newTarget' ).add( ( target ) => {
	if ( commandOverridden ) {
		return;
	}
	commandOverridden = true;

	const originalIsExecutable = ve.ui.IndentationCommand.prototype.isExecutable;
	ve.ui.IndentationCommand.prototype.isExecutable = function ( fragment ) {
		if ( fragment instanceof ve.dm.MWWikitextSurfaceFragment ) {
			return true;
		}
		return originalIsExecutable.call( this, fragment );
	};

	const originalChangeIndentation = ve.ui.IndentationAction.prototype.changeIndentation;
	ve.ui.IndentationAction.prototype.changeIndentation = function ( indent ) {
		if ( this.surface.getMode() !== 'source' ) {
			return;
		}

		// The current selection:
		let fragment = this.surface.getModel().getFragment()
			// With how the wikitext surface works, this will be the current paragraph-that's-a-wikitext-line:
			.expandLinearSelection()
			// Just the text contents of that paragraph:
			.adjustLinearSelection( 1, -1 )
			.setAutoSelect( false );
		const lineText = fragment.getText();
		const openingWhitespace = lineText.length - lineText.trimStart().length;

		// And now we have a fragment containing just whatever whitespace opens the line:
		fragment = fragment.truncateLinearSelection( openingWhitespace );

		if ( indent > 0 ) {
			// Add indentation
			let insert = INDENT;
			if ( openingWhitespace % INDENT.length !== 0 ) {
				insert = INDENT[ 0 ].repeat( INDENT.length - ( openingWhitespace % INDENT.length ) );
			}
			fragment = fragment.collapseToEnd().insertContent( insert ).collapseToEnd();
		} else {
			// Remove indentation
			fragment = fragment.truncateLinearSelection( -INDENT.length ).removeContent().collapseToEnd();
		}
		if ( SELECT ) {
			fragment.select();
		}
		return true;
	};

} );

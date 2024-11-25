mw.hook( 've.activationComplete' ).add( function () {

if ( !mw.editcheck ) {
	// console.log("Not loading ImageAlt editcheck: editcheck isn't loaded");
	return;
}

let ImageAltEditCheck = function( config ) {
	config = config || {
		minimumCharacters: 0,
	};
	ImageAltEditCheck.super.call( this, config );
};

OO.inheritClass( ImageAltEditCheck, mw.editcheck.BaseEditCheck );

ImageAltEditCheck.static.name = 'imageAlt';
ImageAltEditCheck.static.title = "Image needs alt text";
ImageAltEditCheck.static.description = "This image is lacking alt text, which is important for accessibility. Add alt text?";

ImageAltEditCheck.prototype.onBeforeSave = function ( diff ) {
	return this.findAddedElements( diff, 'mwBlockImage' )
		.filter( ( image ) => !image.getAttribute( 'alt' ) )
		.map( ( image ) => {
			const fragment = diff.surface.getModel().getFragment( new ve.dm.LinearSelection( image.getOuterRange() ) );
			return new mw.editcheck.EditCheckAction( {
				diff: diff,
				check: this,
				highlight: fragment,
				selection: fragment,
			} );
		} );
};

ImageAltEditCheck.prototype.act = function ( choice, action ) {
	const surface = action.diff.surface;
	const windowAction = ve.ui.actionFactory.create( 'window', surface, 'check' );
	switch ( choice ) {
		case 'accept':
			action.selection.select();
			return windowAction.open( 'media' ).then( ( instance ) => instance.closing );
		case 'reject':
			return ve.createDeferred().resolve( true ).promise();
	}
};

// Upstream
ImageAltEditCheck.prototype.findAddedElements = function ( diff, type ) {
	const documentModel = diff.documentModel;
	const matchedNodes = [];
	this.getAllModifiedRangesFromDiff( diff ).forEach( ( range ) => {
		const nodes = documentModel.selectNodes( range, 'covered' );
		nodes.forEach( ( node ) => {
			if ( node.node.getType() == type ) {
				matchedNodes.push( node.node );
			}
		} );
	} );
	return matchedNodes;
};

// Upstream this? It's getting *all* the modified ranges, not the upstream version which is just the content-ranges
ImageAltEditCheck.prototype.getAllModifiedRangesFromDiff = function ( diff ) {
	const documentModel = diff.documentModel;
	if ( !documentModel.completeHistory.getLength() ) {
		return [];
	}
	let operations;
	try {
		operations = documentModel.completeHistory.squash().transactions[ 0 ].operations;
	} catch ( err ) {
		// TransactionSquasher can sometimes throw errors; until T333710 is
		// fixed just skip this
		mw.errorLogger.logError( err, 'error.visualeditor' );
		return [];
	}

	const ranges = [];
	let offset = 0;
	const endOffset = documentModel.getDocumentRange().end;
	operations.every( ( op ) => {
		if ( op.type === 'retain' ) {
			offset += op.length;
		} else if ( op.type === 'replace' ) {
			ranges.push( new ve.Range( offset, offset + op.insert.length ) );
			offset += op.insert.length;
		}
		// Reached the end of the doc / start of internal list, stop searching
		return offset < endOffset;
	} );
	return ranges;
};

mw.editcheck.editCheckFactory.register( ImageAltEditCheck );

} );

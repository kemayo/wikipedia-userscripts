mw.hook( 've.newTarget' ).add( function ( target ) {

if ( target.constructor.static.name !== 'article' ) {
	return;
}

if ( !mw.editcheck ) {
	// console.log("Not loading ImageCaption editcheck: editcheck isn't loaded");
	return;
}

let ImageCaptionEditCheck = function( config ) {
	ImageCaptionEditCheck.super.call( this, config );
};

OO.inheritClass( ImageCaptionEditCheck, mw.editcheck.BaseEditCheck );

ImageCaptionEditCheck.static.name = 'imageCaption';
ImageCaptionEditCheck.static.title = "Image needs caption";
ImageCaptionEditCheck.static.description = "This image is lacking a caption, which can be important to readers to explain why the image is present. Not every image needs a caption; some are simply decorative. Relatively few may be genuinely self-explanatory. Does this image need a caption?";

ImageCaptionEditCheck.prototype.onBeforeSave = function ( surfaceModel ) {
	return this.getAddedNodes( surfaceModel.getDocument(), 'mwBlockImage' )
		.filter( ( image ) => image.children[ 0 ] && image.children[ 0 ].getType() == 'mwImageCaption' && image.children[ 0 ].length === 2 )
		.map( ( image ) => {
			return new mw.editcheck.EditCheckAction( {
				check: this,
				fragments: [ surfaceModel.getFragment( new ve.dm.LinearSelection( image.getOuterRange() ) ) ],
			} );
		} );
};

ImageCaptionEditCheck.prototype.act = function ( choice, action, surface ) {
	const windowAction = ve.ui.actionFactory.create( 'window', surface, 'check' );
	switch ( choice ) {
		case 'accept':
			action.fragments[ 0 ].select();
			return windowAction.open( 'media' ).then( ( instance ) => instance.closing );
		case 'reject':
			return ve.createDeferred().resolve( true ).promise();
	}
};

mw.editcheck.editCheckFactory.register( ImageCaptionEditCheck );

} );

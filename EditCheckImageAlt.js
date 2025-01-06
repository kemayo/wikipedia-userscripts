mw.hook( 've.activationComplete' ).add( function () {

if ( !mw.editcheck ) {
	// console.log("Not loading ImageAlt editcheck: editcheck isn't loaded");
	return;
}

let ImageAltEditCheck = function( config ) {
	ImageAltEditCheck.super.call( this, config );
};

OO.inheritClass( ImageAltEditCheck, mw.editcheck.BaseEditCheck );

ImageAltEditCheck.static.name = 'imageAlt';
ImageAltEditCheck.static.title = "Image needs alt text";
ImageAltEditCheck.static.description = "This image is lacking alt text, which is important for accessibility. Add alt text?";

ImageAltEditCheck.prototype.onBeforeSave = function ( surfaceModel ) {
	return this.getAddedNodes( surfaceModel.getDocument(), 'mwBlockImage' )
		.filter( ( image ) => !image.getAttribute( 'alt' ) )
		.map( ( image ) => {
			return new mw.editcheck.EditCheckAction( {
				check: this,
				fragments: [ surfaceModel.getFragment( new ve.dm.LinearSelection( image.getOuterRange() ) ) ],
			} );
		} );
};

ImageAltEditCheck.prototype.act = function ( choice, action, surface ) {
	const windowAction = ve.ui.actionFactory.create( 'window', surface, 'check' );
	switch ( choice ) {
		case 'accept':
			action.fragments[ 0 ].select();
			return windowAction.open( 'media' ).then( ( instance ) => instance.closing );
		case 'reject':
			return ve.createDeferred().resolve( true ).promise();
	}
};

mw.editcheck.editCheckFactory.register( ImageAltEditCheck );

} );

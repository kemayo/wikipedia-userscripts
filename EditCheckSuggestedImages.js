setTimeout( () => {

mw.hook( 've.newTarget' ).add( function ( target ) {

if ( target.constructor.static.name !== 'article' ) {
	return;
}

if ( !mw.editcheck ) {
	return;
}

if ( mw.editcheck.SuggestedImageEditCheck ) {
	return;
}

// TODO: remove after I0a415e9fa322ab75304ddaf9777615a9a3e7ea56 is merged
ve.dm.MWImageModel.static.newFromImageInfo = function ( info, parentDoc ) {
	const imageTitleText = info.title || info.canonicaltitle;
	// Run title through mw.Title so the File: prefix is localised
	const title = mw.Title.newFromText( imageTitleText ).getPrefixedText();
	// Map imageinfo onto attributes
	const attrs = {
		// Per https://www.mediawiki.org/w/?diff=931265&oldid=prev
		href: './' + title,
		src: info.url,
		resource: './' + title,
		width: info.thumbwidth || info.width,
		height: info.thumbheight || info.height,
		mediaType: info.mediatype,
		type: info.type || ( info.thumbwidth ? 'thumb' : 'none' ),
		align: 'default',
		defaultSize: true,
		imageClassAttr: 'mw-file-element'
	};
	return ve.dm.MWImageModel.static.newFromImageAttributes( attrs, parentDoc );
};

/*
 * SuggestedImageEditCheck
 *
 * Offers to add images suggested by the suggested image service.
 *
 * @class
 * @extends mw.editcheck.LinkEditCheck
 *
 * @constructor
 * @param {mw.editcheck.Controller} controller
 * @param {Object} [config]
 * @param {boolean} [includeSuggestions=false]
 */
mw.editcheck.SuggestedImageEditCheck = function () {
	mw.editcheck.SuggestedImageEditCheck.super.apply( this, arguments );
};

/* Inheritance */

OO.inheritClass( mw.editcheck.SuggestedImageEditCheck, mw.editcheck.BaseEditCheck );

/* Static properties */

mw.editcheck.SuggestedImageEditCheck.static.defaultConfig = ve.extendObject( {}, mw.editcheck.BaseEditCheck.static.defaultConfig, {
	showAsCheck: false, // This would never make sense to enable
	showAsSuggestion: false
} );

mw.editcheck.SuggestedImageEditCheck.static.name = 'suggestedImage';
mw.editcheck.SuggestedImageEditCheck.static.title = 'Add an image';
mw.editcheck.SuggestedImageEditCheck.static.description = 'Do you want to add this image?';

mw.editcheck.SuggestedImageEditCheck.static.choices = [
	{
		action: 'accept',
		label: OO.ui.deferMsg( 'editcheck-dialog-action-yes' ),
		icon: 'check'
	},
	{
		action: 'dismiss',
		label: OO.ui.deferMsg( 'editcheck-dialog-action-no' ),
		icon: 'close'
	}
];

mw.editcheck.SuggestedImageEditCheck.static.cachedPromises = new Map();

/* Static methods */

mw.editcheck.SuggestedImageEditCheck.static.fetchSuggestions = function ( surfaceModel ) {
	if ( !this.cachedPromises.has( surfaceModel ) ) {
		this.cachedPromises.set( surfaceModel, new mw.Api().get( {
			action: 'query',
			format: 'json',
			prop: 'growthimagesuggestiondata',
			gisdtasktype: 'section-image-recommendation',
			titles: mw.config.get( 'wgRelevantPageName' ),
			formatversion: '2'
		} ).then(
			( response ) => ve.getProp( response, 'query', 'pages', 0, 'growthimagesuggestiondata', 0, 'images' )
		) );
	}
	return this.cachedPromises.get( surfaceModel );
};

/* Methods */

mw.editcheck.SuggestedImageEditCheck.prototype.onDocumentChange = function ( surfaceModel ) {
	return this.constructor.static.fetchSuggestions( surfaceModel ).then( ( imageData ) => {
		if ( !imageData ) {
			return null;
		}
		const documentModel = surfaceModel.getDocument();
		const modified = this.getModifiedRanges( documentModel );
		// TODO: check API to see what it counts as a section
		const headings = this.getHeadingsFromDocument( documentModel ).filter( ( heading ) => heading.getAttribute( 'level' ) === 2 );
		return imageData.map( ( image ) => {
			const heading = headings[ image.sectionNumber - 1 ];
			const range = heading.getRange();
			if (
				// The heading still exists in the same place with the same name
				documentModel.data.getText( false, range ).replace( ' ', '_' ) === image.sectionTitle &&
				!this.isDismissedRange( range ) &&
				modified.some( ( modifiedRange ) => modifiedRange.touchesRange( range ) )
				// TODO: check whether there's an image here already
			) {
				return new mw.editcheck.SuggestedImageEditCheckAction( {
					image,
					message: image.metadata.reason,
					fragments: [ surfaceModel.getLinearFragment( range ) ],
					check: this
				} );
			}
			return null;
		} );
	} );
};

mw.editcheck.SuggestedImageEditCheck.prototype.act = function ( choice, action, surface ) {
	if ( choice === 'accept' ) {
		return new mw.Api().get( {
			action: 'query',
			format: 'json',
			prop: 'imageinfo',
			titles: mw.Title.newFromText( action.image.image, mw.config.get( 'wgNamespaceIds' ).file ).getPrefixedDb(),
			iiprop: 'dimensions|url|mediatype|canonicaltitle',
			iiurlwidth: mw.config.get( 'wgVisualEditorConfig' ).thumbLimits[ mw.user.options.get( 'thumbsize' ) ] || 250,
			formatversion: '2'
		} ).then( ( response ) => {
			const imageinfo = ve.getProp( response, 'query', 'pages', 0, 'imageinfo', 0 );
			if ( !imageinfo ) {
				return;
			}
			// This covers the full mwHeading; we want to insert the image after it.
			const fragment = action.fragments[ 0 ];
			// TODO: this should be smarter; it'd ideally want to find the
			// first paragraph following the heading and insert before it, to
			// avoid things like "main article" templates.
			const documentModel = surface.getModel().getDocument();
			const nextOffset = documentModel.getNearestCursorOffset( fragment.selection.getCoveringRange().end, 1 );
			const insertionFragment = surface.getModel().getLinearFragment( new ve.Range( nextOffset ) );
			const imageModel = ve.dm.MWImageModel.static.newFromImageInfo( imageinfo, documentModel );
			insertionFragment.insertContent( imageModel.getData() );
			const leafNodes = insertionFragment.getLeafNodes();
			action.focusFragment = insertionFragment;
			if ( leafNodes.length > 0 ) {
				const leaf = leafNodes[ 0 ];
				if ( leaf.node.findParent( ve.dm.MWImageCaptionNode ) ) {
					// We've definitely inserted an image with a caption, and
					// the leaf we have selected is the paragraph node inside the caption.
					const captionFragment = surface.getModel().getLinearFragment( leaf.nodeRange );
					if ( action.image.metadata.caption ) {
						captionFragment.insertContent( action.image.metadata.caption );
					}
					action.focusFragment = captionFragment;
				}
			}
			action.select( surface );
			// Stop suggesting:
			this.dismiss( action );
		} );
	}
	// Parent method
	return mw.editcheck.SuggestedImageEditCheck.super.prototype.act.apply( this, arguments );
};

/* Registration */

mw.editcheck.editCheckFactory.register( mw.editcheck.SuggestedImageEditCheck );

mw.editcheck.SuggestedImageEditCheckAction = function ( config ) {
	mw.editcheck.SuggestedImageEditCheckAction.super.call( this, config );

	this.image = config.image;
};

OO.inheritClass( mw.editcheck.SuggestedImageEditCheckAction, mw.editcheck.EditCheckAction );

/**
 * @inheritdoc
 */
mw.editcheck.SuggestedImageEditCheckAction.prototype.render = function () {
	const widget = mw.editcheck.SuggestedImageEditCheckAction.super.prototype.render.apply( this, arguments );

	const imageData = ve.getProp( this, 'image', 'metadata' );
	if ( imageData ) {
		const $link = $( '<a>' ).append(
			$( '<img>' ).attr( 'src', imageData.thumbUrl )
		);
		ve.setAttributeSafe( $link[ 0 ], 'href', imageData.descriptionUrl );
		ve.targetLinksToNewWindow( $link[ 0 ] );
		widget.message.$element.after( $link );
	}
	return widget;
};


//

} );

}, 1000 );
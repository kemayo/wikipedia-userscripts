setTimeout( () => {

mw.hook( 've.newTarget' ).add( function ( target ) {

if ( target.constructor.static.name !== 'article' ) {
	return;
}

if ( !mw.editcheck ) {
	return;
}

const linkData = [];

// TODO: build this in some more robust manner:
const parts = window.location.hostname.split('.');
const linksPromise = mw.editcheck.fetchTimeout( `https://api.wikimedia.org/service/linkrecommendation/v1/linkrecommendations/${ parts[ 1 ] }/${ parts[ 0 ] }/${ mw.config.get('wgRelevantPageName') }` )
	.then( ( response ) => response.json() );

target.on( 'surfaceReady', () => {
	const surfaceModel = target.surface.getModel();
	const documentModel = surfaceModel.getDocument();
	// Turn the API results into fragments
	linksPromise.then( ( results ) => {
		if ( !ve.getProp( results, 'links' ) ) {
			return;
		}
		// This could be optimized by squashing it into a single finder
		results.links.forEach( ( result ) => {
			const ranges = documentModel.findText( result.context_before + result.link_text + result.context_after, { caseSensitiveString: true } );
			const range = ranges[ result.match_index ];
			if ( !range ) {
				return;
			}
			result.title = mw.Title.newFromText( result.link_target );
			result.fragment = surfaceModel.getLinearFragment( new ve.Range( range.start + result.context_before.length, range.end - result.context_after.length ) );
			linkData.push( result );
		} );
		if ( linkData.length > 0 ) {
			target.editcheckController.refresh();
		}
	} );
} );

let SuggestedLinksEditCheck = function() {
	SuggestedLinksEditCheck.super.apply( this, arguments );
};

OO.inheritClass( SuggestedLinksEditCheck, mw.editcheck.LinkEditCheck );

SuggestedLinksEditCheck.static.defaultConfig = ve.extendObject( {}, mw.editcheck.BaseEditCheck.static.defaultConfig, {
	// enabled: false,
	// showAsCheck: false, showAsSuggestion: true
	context: [ 'suggestion' ],
	predictionThreshold: 0.6
} );

SuggestedLinksEditCheck.static.name = 'suggestedLinks';
SuggestedLinksEditCheck.static.title = "Suggested link";
SuggestedLinksEditCheck.static.description = "Does this link sound like a good idea?";

SuggestedLinksEditCheck.static.choices = [
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

SuggestedLinksEditCheck.static.linkClasses = [ ve.dm.MWInternalLinkAnnotation ];

SuggestedLinksEditCheck.prototype.onDocumentChange = function ( surfaceModel ) {
	const documentModel = surfaceModel.getDocument();
	const modified = this.getModifiedRanges( documentModel );
	return linkData.map( ( link ) => {
		const range = link.fragment.getSelection().getRange();
		if (
			link.score >= this.config.predictionThreshold &&
			!this.isDismissedRange( range ) &&
			!this.getLinkFromFragment( link.fragment ) &&
			modified.some( ( modifiedRange ) => modifiedRange.touchesRange( range ) )
		) {
			return this.buildActionFromLinkRange( range, surfaceModel, {
				message: "Do you want to link this to " + link.link_target + "?"
			} );
		}
		return null;
	} );
};

SuggestedLinksEditCheck.prototype.act = function ( choice, action, surface ) {
	if ( choice === 'accept' ) {
		const fragment = action.fragments[ 0 ];
		const link = linkData.find( ( ln ) => ln.fragment.getSelection().equals( fragment.getSelection() ) );
		if ( !link ) {
			return;
		}
		fragment.annotateContent( 'clear', ve.dm.MWInternalLinkAnnotation.static.name );
		fragment.annotateContent( 'set', ve.dm.MWInternalLinkAnnotation.static.newFromTitle( link.title ) );
		action.select( surface, true );
		return;
	}
	// Parent method
	return SuggestedLinksEditCheck.super.prototype.act.apply( this, arguments );
};

mw.editcheck.editCheckFactory.register( SuggestedLinksEditCheck );

} );

}, 1000 );
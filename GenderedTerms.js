mw.hook( 've.newTarget' ).add( function ( target ) {

// https://en.wikipedia.org/wiki/Wikipedia:Manual_of_Style#Gender-neutral_language

if ( target.constructor.static.name !== 'article' ) {
	return;
}

if ( !mw.editcheck ) {
	// console.log("Not loading ImageCaption editcheck: editcheck isn't loaded");
	return;
}

let GenderedTermsEditCheck = function( config ) {
	GenderedTermsEditCheck.super.call( this, config );

	this.TARGET_REGEX = this.pattern();
};

OO.inheritClass( GenderedTermsEditCheck, mw.editcheck.BaseEditCheck );

GenderedTermsEditCheck.static.name = 'genderedTerms';
GenderedTermsEditCheck.static.title = "Use gender-neutral language";
GenderedTermsEditCheck.static.description = "Use gender-neutral language – avoiding the generic he, for example – if this can be done with clarity and precision. This does not apply to direct quotations or the titles of works (\"The Ascent of Man\"), which should not be altered, or to wording about one-gender contexts, such as an all-female school (\"When any student breaks that rule, she loses privileges\").";

GenderedTermsEditCheck.static.choices = [
	{
		action: 'accept',
		label: ve.msg( 'ooui-dialog-message-accept' )
	},
	{
		action: 'dismiss',
		label: ve.msg( 'ooui-dialog-process-dismiss' )
	}
];

GenderedTermsEditCheck.static.REPLACEMENTS = {
	'manned': 'piloted',
	'unmanned': 'unpiloted',
	// I grabbed: https://wmich.edu/writing/genderbias
	'mankind': 'humanity',
	'manpower': 'work force',
	'to man': 'to staff',
	'fathering': 'begetting',
	'mothering': 'nurturing',
	'fireman': 'firefighter',
	'policeman': 'police officer',
	'postman': 'postal worker',
	'chairman': 'chair',
	'chairwoman': 'chair',
};

GenderedTermsEditCheck.prototype.pattern = function() {
	// Note: *not* case-sensitive, to avoid proper nouns
	return new RegExp( '\\b(' + Object.keys( this.constructor.static.REPLACEMENTS ).join( '|' ) + ')\\b', 'g' );
};

GenderedTermsEditCheck.prototype.onBeforeSave = function ( surfaceModel ) {
	const actions = [];
	const modified = this.getModifiedContentRanges( surfaceModel.getDocument() );
	surfaceModel.getDocument().findText( this.TARGET_REGEX )
		.filter( ( range ) => !this.isDismissedRange( range ) )
		.filter( ( range ) => modified.some( ( modRange ) => range.touchesRange( modRange ) ) )
		.filter( ( range ) => this.isRangeInValidSection( range, surfaceModel.documentModel ) )
		.forEach( ( range ) => {
			const fragment = surfaceModel.getLinearFragment( range );
			actions.push(
				new mw.editcheck.EditCheckAction( {
					fragments: [ fragment ],
					check: this
				} )
			);
		} );
	return actions;
};

GenderedTermsEditCheck.prototype.getDescription = function( action ) {
	const fragment = action.fragments[ 0 ];
	const oldWord = fragment.getText();
	const newWord = this.constructor.static.REPLACEMENTS[ oldWord /*.toLowerCase()*/ ];
	return this.constructor.static.description + `\n\nReplace "${ oldWord }" with "${ newWord }"?`;
};

GenderedTermsEditCheck.prototype.act = function ( choice, action, surface ) {
	if ( choice === 'dismiss' ) {
		this.dismiss( action );
	} else if ( choice === 'accept' ) {
		const fragment = action.fragments[ 0 ];
		const oldWord = fragment.getText();
		const newWord = this.constructor.static.REPLACEMENTS[ oldWord /*.toLowerCase()*/ ];
		if ( newWord ) {
			fragment.removeContent().insertContent( newWord );
		} else {
			ve.log( `GenderedTermsEditCheck.prototype.act(): did not find replacement for ${ oldWord }` );
		}
	}
	return ve.createDeferred().resolve( {} );
};

mw.editcheck.editCheckFactory.register( GenderedTermsEditCheck );

} );

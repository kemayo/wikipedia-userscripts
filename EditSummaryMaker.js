// EditSummaryMaker.js
// Suggests an edit summary when the VE save dialog opens.

// If merged into core, a lot of the logic here is basically cribbed from
// ve.ui.DiffElement; might want to make a non-UI version of the
// data-processing parts of that.

( function () { setTimeout( () => {

'use strict';

function* iterateDiff( diff ) {
	// see ve.ui.DiffElement.prototype.iterateDiff
	if ( Array.isArray( diff ) ) {
		for ( let item of diff ) {
			let node;
			switch ( item.diff ) {
				case 1:
					node = diff.newList.children[ item.nodeIndex ];
					yield [ 'insert', node, item.indexOrder ];
					break;
				case -1:
					node = diff.oldList.children[ item.nodeIndex ];
					yield [ 'remove', node, item.indexOrder ];
					break;
			}
		}
		return;
	}
	const len = Math.max( diff.oldNodes.length, diff.newNodes.length );
	for ( let i = 0, j = 0; i < len || j < len; i++, j++ ) {
		const move = diff.moves[ j ] === 0 ? null : diff.moves[ j ];
		if ( diff.oldNodes[ i ] === undefined ) {
			// Everything else in the new doc list is an insert
			while ( j < diff.newNodes.length ) {
				yield [ 'insert', diff.newNodes[ j ], j ];
				j++;
			}
		} else if ( diff.newNodes[ j ] === undefined ) {
			// Everything else in the old doc is a remove
			while ( i < diff.oldNodes.length ) {
				yield [ 'remove', diff.oldNodes[ i ], i ];
				i++;
			}
		} else if ( diff.remove.includes( i ) ) {
			// The old node is a remove. Decrement the new node index
			// to compare the same new node to the next old node
			yield [ 'remove', diff.oldNodes[ i ], i ];
			j--;
		} else if ( diff.insert.includes( j ) ) {
			// The new node is an insert. Decrement the old node index
			// to compare the same old node to the next new node
			yield [ 'insert', diff.newNodes[ j ], j ];
			i--;
		// DiffElement uses this to handle reflist nodes:
		// } else if (
		// 	callbacks.preChanged &&
		// 	callbacks.preChanged( diff.oldNodes[ i ], diff.newNodes[ j ], move, i, j )
		// ) {
		// 	// preChanged ran
		} else if ( typeof diff.newToOld[ j ] === 'number' ) {
			// The old and new node are exactly the same
			yield [ 'move', diff.newNodes[ j ], move, j ];
		} else {
			const oldNodeIndex = diff.newToOld[ j ].node;
			const oldNode = diff.oldNodes[ oldNodeIndex ];
			const newNode = diff.newNodes[ diff.oldToNew[ oldNodeIndex ].node ];
			const nodeDiff = diff.oldToNew[ oldNodeIndex ].diff;

			// The new node is modified from the old node
			yield [ 'change', nodeDiff, oldNode, newNode, move, i, j ];
		}
	}
}

function linearDataToNodes( data, doc ) {
	const documentSlice = doc.cloneWithData( data );
	documentSlice.getStore().merge( doc.getStore() );
	return documentSlice.selectNodes( new ve.Range( 1, documentSlice.data.length - 2 ) ).map( ( result ) => result.node );
	// To HTMLElements:
	// const nodeElements = ve.dm.converter.getDomFromModel( documentSlice, ve.dm.Converter.static.PREVIEW_MODE ).body;
	// // Convert NodeList to real array
	// return Array.prototype.slice.call( nodeElements.childNodes );
}

/**
 * @param {ve.dm.DocumentNode} oldDoc
 * @param {ve.dm.DocumentNode} newDoc
 * @return {string}
 */
function generateSummary( visualDiff ) {
	// see ve.ui.DiffElement.prototype.iterateDiff
	const summary = new Map();
	console.log( 'DOC' );
	for ( let change of iterateDiff( visualDiff.diff.docDiff ) ) {
		console.log( change );
		let section, sectionSummary;
		switch ( change[ 0 ] ) {
			case 'change': {
				// This node changed somehow
				// most interesting changes are going to be in here, because this includes additions to existing paragraph nodes
				const [ _, nodeDiff, oldNode, newNode, move ] = change;
				section = findSectionNameForNode( newNode );
				sectionSummary = summary.set( section, summary.get( section ) || new Set() ).get( section );
				if ( nodeDiff.attributeChange ) {
					// Attributes of newNode changed
					console.log( '>attributes', newNode, nodeDiff.attributeChange );
					sectionSummary.add( `updated attributes of ${ newNode.getType() }` );
				}
				if ( nodeDiff.linearDiff ) {
					// Contents of newNode changed
					for ( const lin of nodeDiff.linearDiff ) {
						const [ action, data ] = lin;
						let nodes;
						switch ( action ) {
							case ve.DiffMatchPatch.static.DIFF_EQUAL:
								console.log( '>unchanged', data );
								break;
							case ve.DiffMatchPatch.static.DIFF_INSERT:
							// case ve.DiffMatchPatch.static.DIFF_CHANGE_INSERT:
								nodes = linearDataToNodes( data, newNode.getDocument() );
								console.log( '>insertion', data, nodes );
								for ( let node of nodes ) {
									sectionSummary.add( `insert ${ node.getType() }` );
								}
								break;
							case ve.DiffMatchPatch.static.DIFF_DELETE:
							// case ve.DiffMatchPatch.static.DIFF_CHANGE_DELETE:
								nodes = linearDataToNodes( data, oldNode.getDocument() );
								console.log( '>deletion', data, nodes );
								for ( let node of nodes ) {
									sectionSummary.add( `remove ${ node.getType() }` );
								}
								break;
						}
					}
				}
				break;
			}
			// case 'move':
			case 'insert':
			case 'remove': {
				console.log( change[ 0 ], change );
				section = findSectionNameForNode( change[ 1 ] );
				sectionSummary = summary.set( section, summary.get( section ) || new Set() ).get( section );
				sectionSummary.add( `${ change[ 0 ] } ${ change[ 1 ].getType() }` );
				break;
			}
		}
	}
	// console.log( 'INTERNALLIST' );
	// for ( let group in visualDiff.diff.internalListDiff.groups ) {
	// 	console.log( group );
	// 	for ( let change of iterateDiff( visualDiff.diff.internalListDiff.groups[ group ] ) ) {
	// 		console.log( change );
	// 		if ( group === 'mwReference/' ) {
	// 			if ( change[ 0 ] === 'insert' ) {
	// 			}
	// 		}
	// 	}
	// }
	const output = [];
	for ( let [ section, actions ] of summary ) {
		const actionStr = Array.from( actions ).join( ', ' );
		output.push( section ? `In ${ section }: ${ actionStr }` : actionStr );
	}
	return output.join( '. ' ).trim();
}

function findSectionForNode( node ) {
	const start = node.getRange().start;
	const headings = node.getDocument().getNodesByType( 'mwHeading', true );
	for ( let heading of headings.reverse() ) {
		const range = heading.getOuterRange();
		if ( range.start < start ) {
			return heading;
		}
	}
	return null;
}

function findSectionNameForNode( node ) {
	const heading = findSectionForNode( node );
	if ( heading ) {
		return heading.getDocument().data.getText( false, heading.getRange() ).trim();
	}
	if ( node.getDocument().getNodesByType( 'mwHeading' ).length > 0 ) {
		return 'lead section';
	}
	return null;
}

mw.hook( 've.newTarget' ).add( ( target ) => {
	let ourEditSummary;
	target.getPreSaveProcess().next( () => {
		if ( target.initialEditSummary && target.initialEditSummary !== ourEditSummary ) {
			return;
		}

		return target.getVisualDiffGeneratorPromise().then( ( visualDiffGenerator ) => {
			try {
				const suggestion = generateSummary( visualDiffGenerator() );
				if ( suggestion ) {
					target.initialEditSummary = suggestion;
					ourEditSummary = suggestion;
				}
			} catch ( e ) {
				mw.log.warn( 'EditSummaryHelper: failed to generate summary', e );
			}
		} );
	} );
} );

}, 1000 ) }() );
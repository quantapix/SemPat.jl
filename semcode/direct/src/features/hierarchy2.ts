import * as qv from 'vscode';
export class FoodPyramidHierarchy implements qv.CallHierarchyProvider {
  prepareCallHierarchy(d: qv.TextDocument, p: qv.Position, _: qv.CancellationToken): qv.CallHierarchyItem | undefined {
    const range = d.getWordRangeAtPosition(p);
    if (range) {
      const word = d.getText(range);
      return this.createCallHierarchyItem(word, '', d, range);
    } else return undefined;
  }
  async provideCallHierarchyOutgoingCalls(item: qv.CallHierarchyItem, token: qv.CancellationToken): Promise<qv.CallHierarchyOutgoingCall[] | undefined> {
    const document = await qv.workspace.openTextDocument(item.uri);
    const parser = new FoodPyramidParser();
    parser.parse(document);
    const model = parser.getModel();
    const originRelation = model.getRelationAt(item.range);
    const outgoingCallItems: qv.CallHierarchyOutgoingCall[] = [];
    if (model.isVerb(item.name)) {
      const outgoingCalls = model.getVerbRelations(item.name).filter((relation) => relation.subject === originRelation!.subject);
      outgoingCalls.forEach((relation) => {
        const outgoingCallRange = relation.getRangeOf(relation.object);
        const verbItem = this.createCallHierarchyItem(relation.object, 'noun', document, outgoingCallRange);
        const outgoingCallItem = new qv.CallHierarchyOutgoingCall(verbItem, [outgoingCallRange]);
        outgoingCallItems.push(outgoingCallItem);
      });
    } else if (model.isNoun(item.name)) {
      const outgoingCallMap = groupBy(model.getSubjectRelations(item.name), (relation) => relation.verb);
      outgoingCallMap.forEach((relations, verb) => {
        const outgoingCallRanges = relations.map((relation) => relation.getRangeOf(verb));
        const verbItem = this.createCallHierarchyItem(verb, 'verb', document, outgoingCallRanges[0]);
        const outgoingCallItem = new qv.CallHierarchyOutgoingCall(verbItem, outgoingCallRanges);
        outgoingCallItems.push(outgoingCallItem);
      });
    }
    return outgoingCallItems;
  }
  async provideCallHierarchyIncomingCalls(item: qv.CallHierarchyItem, token: qv.CancellationToken): Promise<qv.CallHierarchyIncomingCall[]> {
    const document = await qv.workspace.openTextDocument(item.uri);
    const parser = new FoodPyramidParser();
    parser.parse(document);
    const model = parser.getModel();
    const originRelation = model.getRelationAt(item.range);
    const outgoingCallItems: qv.CallHierarchyIncomingCall[] = [];
    if (model.isVerb(item.name)) {
      const outgoingCalls = model.getVerbRelations(item.name).filter((relation) => relation.object === originRelation!.object);
      outgoingCalls.forEach((relation) => {
        const outgoingCallRange = relation.getRangeOf(relation.subject);
        const verbItem = this.createCallHierarchyItem(relation.subject, 'noun', document, outgoingCallRange);
        const outgoingCallItem = new qv.CallHierarchyIncomingCall(verbItem, [outgoingCallRange]);
        outgoingCallItems.push(outgoingCallItem);
      });
    } else if (model.isNoun(item.name)) {
      const outgoingCallMap = groupBy(model.getObjectRelations(item.name), (relation) => relation.verb);
      outgoingCallMap.forEach((relations, verb) => {
        const outgoingCallRanges = relations.map((relation) => relation.getRangeOf(verb));
        const verbItem = this.createCallHierarchyItem(verb, 'verb-inverted', document, outgoingCallRanges[0]);
        const outgoingCallItem = new qv.CallHierarchyIncomingCall(verbItem, outgoingCallRanges);
        outgoingCallItems.push(outgoingCallItem);
      });
    }
    return outgoingCallItems;
  }
  private createCallHierarchyItem(word: string, type: string, d: qv.TextDocument, r: qv.Range): qv.CallHierarchyItem {
    return new qv.CallHierarchyItem(qv.SymbolKind.Object, word, `(${type})`, d.uri, r, r);
  }
}
class FoodPyramidParser {
  private _model = new FoodPyramid();
  getModel(): FoodPyramid {
    return this._model;
  }
  parse(textDocument: qv.TextDocument): void {
    const pattern = /^(\w+)\s+(\w+)\s+(\w+).$/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(textDocument.getText()))) {
      const startPosition = textDocument.positionAt(match.index);
      const range = new qv.Range(startPosition, startPosition.translate({ characterDelta: match[0].length }));
      this._model.addRelation(new FoodRelation(match[1], match[2], match[3], match[0], range));
    }
  }
}
function groupBy<K, V>(array: Array<V>, keyGetter: (value: V) => K): Map<K, V[]> {
  const map = new Map();
  array.forEach((item) => {
    const key = keyGetter(item);
    const groupForKey = map.get(key) || [];
    groupForKey.push(item);
    map.set(key, groupForKey);
  });
  return map;
}
export class FoodPyramid {
  private _relations: FoodRelation[] = [];
  private _nouns = new Set<string>();
  private _verbs = new Set<string>();
  getRelationAt(wordRange: qv.Range): FoodRelation | undefined {
    return this._relations.find((relation) => relation.range.contains(wordRange));
  }
  addRelation(relation: FoodRelation): void {
    this._relations.push(relation);
    this._nouns.add(relation.object).add(relation.subject);
    this._verbs.add(relation.verb);
  }
  isVerb(name: string): boolean {
    return this._verbs.has(name.toLowerCase());
  }
  isNoun(name: string): boolean {
    return this._nouns.has(name.toLowerCase());
  }
  getVerbRelations(verb: string): FoodRelation[] {
    return this._relations.filter((relation) => relation.verb === verb.toLowerCase());
  }
  getNounRelations(noun: string): FoodRelation[] {
    return this._relations.filter((relation) => relation.involves(noun));
  }
  getSubjectRelations(subject: string): FoodRelation[] {
    return this._relations.filter((relation) => relation.subject === subject.toLowerCase());
  }
  getObjectRelations(object: string): FoodRelation[] {
    return this._relations.filter((relation) => relation.object === object.toLowerCase());
  }
}
export class FoodRelation {
  private _subject: string;
  private _verb: string;
  private _object: string;
  constructor(subject: string, verb: string, object: string, private readonly originalText: string, public readonly range: qv.Range) {
    this._subject = subject.toLowerCase();
    this._verb = verb.toLowerCase();
    this._object = object.toLowerCase();
  }
  get subject(): string {
    return this._subject;
  }
  get object(): string {
    return this._object;
  }
  get verb(): string {
    return this._verb;
  }
  involves(noun: string): boolean {
    const needle = noun.toLowerCase();
    return this._subject === needle || this._object === needle;
  }
  getRangeOf(word: string): qv.Range {
    const indexOfWord = new RegExp('\\b' + word + '\\b', 'i').exec(this.originalText)!.index;
    return new qv.Range(this.range.start.translate({ characterDelta: indexOfWord }), this.range.start.translate({ characterDelta: indexOfWord + word.length }));
  }
}

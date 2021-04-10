import { PyTypedInfo } from './pyTypedUtils';
export const enum ImportType {
  BuiltIn,
  ThirdParty,
  Local,
}
export interface ImplicitImport {
  isStubFile: boolean;
  isNativeLib: boolean;
  name: string;
  path: string;
}
export interface ImportResult {
  importName: string;
  isRelative: boolean;
  isImportFound: boolean;
  isPartlyResolved: boolean;
  isNamespacePackage: boolean;
  isStubPackage: boolean;
  importFailureInfo?: string[];
  importType: ImportType;
  resolvedPaths: string[];
  searchPath?: string;
  isStubFile: boolean;
  isNativeLib: boolean;
  isTypeshedFile?: boolean;
  isLocalTypingsFile?: boolean;
  implicitImports: ImplicitImport[];
  filteredImplicitImports: ImplicitImport[];
  nonStubImportResult?: ImportResult;
  pyTypedInfo?: PyTypedInfo;
  packageDir?: string;
}

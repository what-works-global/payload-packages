export default function stripJsExtensionsFromImports(source) {
  return source.replaceAll(/(from\s+["'].*?)(\.js)(['"];?)$/gm, '$1$3')
}

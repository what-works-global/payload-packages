// import-rewrite-loader.js
export default function stripExtensions(source) {
  return source.replaceAll(/(from\s+["'].*?)(\.js)(['"];?)$/gm, '$1$3')
}

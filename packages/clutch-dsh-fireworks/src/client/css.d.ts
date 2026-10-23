declare module '*.css' {
  const classNames: Record<string, string>;
  export default classNames;
}
declare module '*?raw' {
  const source: string;
  export default source;
}

/** Remotion's bundler emits font files as assets; importing one yields its URL. */
declare module "*.woff2" {
  const url: string;
  export default url;
}

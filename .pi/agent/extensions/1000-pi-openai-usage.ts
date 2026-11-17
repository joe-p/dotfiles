const extension = await import(
  new URL("../vendor/pi-openai-usage/index.ts", import.meta.url).href
);

export default extension.default;

// Su Windows la riga di comando ha un limite di circa 8000 caratteri:
// i file in stage vengono divisi in gruppi per non superarlo.
const CHUNK = 25;

const quote = (file) => `"${file}"`;

function chunked(command) {
  return (files) => {
    const commands = [];
    for (let i = 0; i < files.length; i += CHUNK) {
      commands.push(
        `${command} ${files
          .slice(i, i + CHUNK)
          .map(quote)
          .join(" ")}`,
      );
    }
    return commands;
  };
}

const eslint = chunked("eslint --fix --no-warn-ignored");
const prettier = chunked("prettier --write --ignore-unknown");
const ruffCheck = chunked("node scripts/uv.mjs run --project server ruff check --force-exclude --fix");
const ruffFormat = chunked("node scripts/uv.mjs run --project server ruff format --force-exclude");

export default {
  "*.{ts,tsx,js,mjs}": (files) => [...eslint(files), ...prettier(files)],
  "*.{json,md,css,html,yml,yaml}": prettier,
  "server/**/*.py": (files) => [...ruffCheck(files), ...ruffFormat(files)],
};

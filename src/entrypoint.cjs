const esmRequire = require('esm')(module);

const { default: main } = esmRequire('./main.js');

Promise.resolve()
  .then((_) => main(process.argv.slice(2)))
  .then((ret) => process.exit(ret || 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

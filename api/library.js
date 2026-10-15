const { createApi } = require('../lib/library-server.cjs');
module.exports = createApi(require('@vercel/blob'));

/*
 * config.js — App-wide settings shared by the page and the service worker.
 *
 * To use another translation: put its files in data/<id>/ (see tools/build-data.js),
 * change `translation` below and bump `version` so installed copies update.
 */
(function (root) {
  root.BIBLIA_CONFIG = {
    translation: 'rv1909',
    version: '1.0.3'
  };
})(typeof self !== 'undefined' ? self : this);

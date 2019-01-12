#!/usr/bin/env node
/* eslint-env node */
'use strict';

const Podio = require('podio-js').api;
const sessionStore = require('../sessionStore');
const podioExporter = require('../index');

const CONFIG = require('../config.json'); // TODO: make configurable

const {
  CLIENT_ID,
  CLIENT_SECRET,
  USERNAME,
  PASSWORD,
} = require('../secrets.json'); // TODO: make configurable

var podio = new Podio({
  authType: 'password',
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET
},
{
  sessionStore,
});

podio.isAuthenticated()
  .then(() => {
    // Ready to make API calls...
    podioExporter.retrieveData(podio, USERNAME, CONFIG);
  }).catch((err) => {
    podio.authenticateWithCredentials(USERNAME, PASSWORD, () => {
      // Make API calls here...
      podioExporter.retrieveData(podio, USERNAME, CONFIG);
    });
  });

/* eslint-env mocha */
'use strict';

const fs = require('fs');
const path = require('path');
const RateLimiter = require('limiter').RateLimiter;

var shouldCapture = (testType) => ['capture'].includes(testType);
var shouldMock = (testType) => ['unit'].includes(testType);

/*
 * Configurable test suite parameters
 */
const TEST_TYPE = ['unit', 'integration', 'capture'].includes(process.env.TEST_TYPE) ? process.env.TEST_TYPE : 'integration';
// TEST_TYPE = 'unit' will run unit tests locally (completes in milliseconds). This is the default value.
// TEST_TYPE = 'integration' will run integration tests against local filesystem (completes in milliseconds).
// TEST_TYPE = 'capture' same as integration plus will capture the responses for future unit tests.

const sinon = require('sinon');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const sinonChai = require('sinon-chai');
chai.use(sinonChai);
const expect = chai.expect;
chai.config.includeStack = true;

const Response = require('responselike');
const podio = require('./utils/mockPodio');
const testData = {
  config: require('./data/config.json'),
  username: 'mocha-test',
};
const podioExporter = require('../index');

describe('podio-export', function() {
  describe('#retrieveData()', function() {
    it('invokes retrieveOrgs()', async function() {
      sinon.spy(podioExporter, 'retrieveOrgs');
      await podioExporter.retrieveData(podio, testData.username, testData.config);
      expect(podioExporter.retrieveOrgs).to.have.been.calledOnce;
      podioExporter.retrieveOrgs.restore();
    });

  });

  describe('#retrieveOrgs()', function() {
    beforeEach(function() {
      podioExporter.podio = podio;
      podioExporter.config = testData.config;
      podioExporter.limiter = new RateLimiter(testData.config.RATE_LIMIT, 'hour');
    });

    it('SHOULD_DOWNLOAD_FILES = false returns correct summary and does not download files', function(done) {
      podioExporter.retrieveOrgs(
        path.join(__dirname, 'podio-export'),
        testData.username,
        (err, result) => done(!expect(result).to.deep.equal({
          'mocha-test': {
            'myOrg': {
              'numTasks': 2,
              'myWorkspace': {
                'myApp': {
                  'numFiles': 2,
                  'downloadedFiles': 0,
                  'numItems': 2,
                  'totalItems': 2
                }
              }
            },
            'numContacts': 2
          }
        }))
      );
    });

    it('SHOULD_DOWNLOAD_FILES = true returns correct summary and downloads files', function(done) {
      podioExporter.config.SHOULD_DOWNLOAD_FILES = true;
      podioExporter.retrieveOrgs(
        path.join(__dirname, 'podio-export'),
        `${testData.username}-download`,
        (err, result) => done(!expect(result).to.deep.equal({
          'mocha-test-download': {
            'myOrg': {
              'numTasks': 2,
              'myWorkspace': {
                'myApp': {
                  'numFiles': 2,
                  'downloadedFiles': 2,
                  'numItems': 2,
                  'totalItems': 2
                }
              }
            },
            'numContacts': 2
          }
        }))
      );
    });
  });
});

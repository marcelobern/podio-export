/* eslint-env mocha */
'use strict';

const path = require('path');
const RateLimiter = require('limiter').RateLimiter;


const sinon = require('sinon');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const sinonChai = require('sinon-chai');
chai.use(sinonChai);
const expect = chai.expect;
chai.config.includeStack = true;

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

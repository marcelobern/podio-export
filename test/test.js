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
    beforeEach(function() {
      sinon.spy(console, 'error');
    });

    afterEach(function() {
      console.error.restore(); // eslint-disable-line no-console
    });

    it('retrieveOrgs() does not print error message', async function() {
      await podioExporter.retrieveData(podio, testData.username, testData.config);
      expect(console.error).to.not.have.been.called; // eslint-disable-line no-console
    });

    it('retrieveOrgs() prints error message', async function() {
      sinon.stub(podioExporter, 'retrieveOrgs').callsFake(
        (exportPath, username, callback) => callback(new Error('retrieveOrgs() returns error'))
      );
      await podioExporter.retrieveData(podio, testData.username, testData.config);
      expect(console.error).to.have.been.calledOnce; // eslint-disable-line no-console
      podioExporter.retrieveOrgs.restore();
    });
  });

  describe('#retrieveOrgs()', function() {
    beforeEach(function() {
      podioExporter.podio = podio;
      podioExporter.config = testData.config;
      podioExporter.config.SHOULD_DOWNLOAD_FILES = false;
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

    it('item check fails and returns an Error', function(done) {
      sinon.stub(podioExporter, 'persistData').callsFake(
        (basePath, filename, summary, callback) => {
          if (filename === 'summary.json') {
            const myApp = summary[testData.username].myOrg.myWorkspace.myApp;
            myApp.numItems = myApp.totalItems + 1;
          }
          callback(null);
        }
      );
      podioExporter.retrieveOrgs(
        path.join(__dirname, 'podio-export'),
        `${testData.username}`,
        (err) => {
          podioExporter.persistData.restore();
          return done(!expect(err).to.be.instanceOf(Error));
        }
      );
    });

    it('download check fails and returns an Error', function(done) {
      sinon.stub(podioExporter, 'persistData').callsFake(
        (basePath, filename, summary, callback) => {
          if (filename === 'summary.json') {
            const myApp = summary[testData.username].myOrg.myWorkspace.myApp;
            myApp.numFiles = myApp.downloadedFiles + 1;
          }
          callback(null);
        }
      );
      podioExporter.retrieveOrgs(
        path.join(__dirname, 'podio-export'),
        `${testData.username}`,
        (err) => {
          podioExporter.persistData.restore();
          return done(!expect(err).to.be.instanceOf(Error));
        }
      );
    });
  });

  describe('#retrieveItems()', function() {
    it('process correct number of items when items are over the limit', function(done) {
      const LIMIT = 500;
      const LENGTH = LIMIT + 1;
      podioExporter.podio = {
        request: (method, url, params) => {
          const ITEM_COUNT = params.offset === 0 ? LIMIT : LENGTH - LIMIT;
          return new Promise((resolve) => {
            resolve({
              items: Array(ITEM_COUNT).fill({item: 1}),
              total: LENGTH,
            });
          });
        }
      };
      var summary = {};
      podioExporter.retrieveItems(
        'appId',
        path.join(__dirname, 'podio-export', 'unit-test', 'orgId', 'appPath'),
        summary,
        () => done(!expect(summary).to.deep.equal({
          numItems: LENGTH,
          totalItems: LENGTH,
        }))
      );
    });

    it('recognizes a change in totalItems when items are over the limit', function(done) {
      const LIMIT = 500;
      const LENGTH = LIMIT + 1;
      podioExporter.podio = {
        request: (method, url, params) => {
          const ITEM_COUNT = params.offset === 0 ? LIMIT : LENGTH - LIMIT;
          return new Promise((resolve) => {
            resolve({
              items: Array(ITEM_COUNT).fill({item: 1}),
              total: params.offset === 0 ? LENGTH : LENGTH + 1,
            });
          });
        }
      };
      var summary = {};
      podioExporter.retrieveItems(
        'appId',
        path.join(__dirname, 'podio-export', 'unit-test', 'orgId', 'appPath'),
        summary,
        (err) => done(!expect(err).to.be.instanceOf(Error))
      );
    });

    it('with no items appSummary has numItems & totalItems = 0', function(done) {
      podioExporter.podio = {
        request: () => new Promise((resolve) => resolve({
          items: [],
          total: 0,
        }))
      };
      var summary = {};
      podioExporter.retrieveItems(
        'dummy',
        'dummy',
        summary,
        () => done(!expect(summary).to.deep.equal({
          numItems: 0,
          totalItems: 0,
        }))
      );
    });
  });

  describe('#retrieveTasks()', function() {
    it('with no tasks orgSummary has numTasks = 0', function(done) {
      podioExporter.podio = {
        request: () => new Promise((resolve) => resolve([]))
      };
      var summary = {};
      podioExporter.retrieveTasks(
        'dummy',
        'dummy',
        summary,
        () => done(!expect(summary).to.deep.equal({ numTasks: 0 }))
      );
    });
  });

  describe('#retrieveFiles()', function() {
    it('with no tasks appSummary has numFiles & downloadedFiles = 0', function(done) {
      podioExporter.podio = {
        request: () => new Promise((resolve) => resolve([]))
      };
      var summary = {};
      podioExporter.retrieveFiles(
        'dummy',
        'dummy',
        summary,
        () => done(!expect(summary).to.deep.equal({
          numFiles: 0,
          downloadedFiles: 0,
        }))
      );
    });
  });

  describe('#retrieveContacts()', function() {
    it('with no tasks orgSummary has numContacts = 0', function(done) {
      podioExporter.podio = {
        request: () => new Promise((resolve) => resolve([]))
      };
      var summary = {};
      podioExporter.retrieveContacts(
        'dummy',
        summary,
        () => done(!expect(summary).to.deep.equal({ numContacts: 0 }))
      );
    });
  });

  describe('#downloadFiles()', function() {
    beforeEach(function() {
      podioExporter.config = testData.config;
      podioExporter.config.SHOULD_DOWNLOAD_FILES = true;
    });

    afterEach(function() {
      podioExporter.config.SHOULD_DOWNLOAD_FILES = false;
    });

    it('podioExporter.downloadFile() errs', function(done) {
      sinon.stub(podioExporter, 'downloadFile').callsFake(
        (url, filename, callback) => callback(new Error('testing downloadFiles() error handling'))
      );
      podioExporter.downloadFiles(
        [{
          file_id: 1,
          link: 'dummy.png',
          mimetype: 'image/png',
        }],
        path.join(__dirname, 'podio-export', 'unit-test'),
        {},
        (err) => {
          podioExporter.downloadFile.restore();
          return done(!expect(err).to.be.instanceOf(Error));
        }
      );
    });
  });

  describe('#persistData()', function() {
    it('fs.writeFile() errs', function(done) {
      sinon.stub(fs, 'writeFile').callsFake(
        (filename, content, options, callback) => callback(new Error('testing persistData() error handling'))
      );
      podioExporter.persistData(
        path.join(__dirname, 'podio-export', 'unit-test'),
        'errorHandlingTest.json',
        {},
        (err) => done(!expect(err).to.be.instanceOf(Error))
      );
    });
  });
});

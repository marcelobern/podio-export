/* eslint-env node */
'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const async = require('async');
const mime = require('mime');
const download = require('download');
const RateLimiter = require('limiter').RateLimiter;

const NUM_ITEMS = 'numItems';
const TOTAL_ITEMS = 'totalItems';
const NUM_FILES = 'numFiles';
const DOWNLOADED_FILES = 'downloadedFiles';
var exporter = {};

const shouldUseGoogleDrive = () => exporter.config.SHOULD_USE_GOOGLE_DRIVE;
const shouldDownloadFiles = () => exporter.config.SHOULD_DOWNLOAD_FILES;
const shouldDownloadXlsx = () => exporter.config.SHOULD_DOWNLOAD_XLSX;

const persistData = (basePath, filename, jsonData, callback) => {
  fse.ensureDir(basePath)
    .then(() => {
      var fullPath = path.join(basePath, filename);

      fs.writeFile(fullPath, JSON.stringify(jsonData, null, ' '), 'utf8', function(err) {
        if (err) {
          callback(new Error(`Writing to ${fullPath} failed: ${err}`));
        }
        console.log(`Exported ${fullPath.replace(`${__dirname}/`, '')}`);
        callback(null);
      });
    })
    .catch(callback);
};


exporter.retrieveData = (podioServer, username, config) => {
  exporter.podio = podioServer;
  exporter.config = config;
  exporter.limiter = new RateLimiter(exporter.config.RATE_LIMIT, 'hour');
  const basePath = path.join(__dirname, 'podio-export');
  const flag = true;
  if (flag) {
    exporter.retrieveOrgs(basePath, username, (err, result) => {
      console.log(`podio-export result: ${JSON.stringify(result, null, ' ')}`);
      if (err) console.error(`podio-export ${err}`);
    });
  } else {
  }
};

exporter.retrieveOrgs = (exportPath, username, callback) => {
  const basePath = path.join(exportPath, username.replace('@', '_at_'));

  var summary = {
    [username]: {},
  };

  async.waterfall([
    (callback) => {
      exporter.podio.request('GET', '/org/')
        .then(responseData => callback(null, responseData))
        .catch(callback);
    },
    (orgs, callback) => {
      async.each(orgs, (org, callback) => {
        const orgPath = path.join(basePath, `${org.name}`);
        summary[username][org.name] = {};
        async.parallel({
          [`${org.name}.json`]: (callback) => {
            persistData(orgPath, `${org.name}.json`, org, callback);
          },
          [`${org.name}-tasks`]: (callback) => {
            exporter.retrieveTasks(org.org_id, orgPath, summary[username][org.name], callback);
          },
          [`${org.name}-spaces`]: (callback) => {
            exporter.retrieveSpaces(org.org_id, orgPath, summary[username][org.name], callback);
          }
        }, callback);
      }, callback);
    },
    (callback) => {
      exporter.retrieveContacts(basePath, summary[username], callback);
    },
    (callback) => {
      persistData(basePath, 'summary.json', summary, () => {
        const checkProperties = (object, propertyA, propertyB) => {
          var result = null;
          for (var element in object) {
            if (typeof object[element] === 'object' && !(propertyA in object[element]) && !(propertyB in object[element])) {
              result = checkProperties(object[element], propertyA, propertyB);
            } else if (object[element][propertyA] !== object[element][propertyB]) result = element;
            if (result) break;
          }
          return result;
        };
        const itemsCheck = checkProperties(summary, NUM_ITEMS, TOTAL_ITEMS);
        const filesCheck = checkProperties(summary, NUM_FILES, DOWNLOADED_FILES);
        if (itemsCheck) {
          callback(new Error(`Not all items for application '${itemsCheck}' have been exported!`), summary);
        } else if (filesCheck) {
          callback(new Error(`Not all files for application '${filesCheck}' have been downloaded!`), summary);
        } else callback(null, summary);
      });
    },
  ], callback);
};

exporter.retrieveSpaces = (orgId, orgPath, orgSummary, callback) => {
  async.waterfall([
    (callback) => {
      exporter.podio.request('GET', `/space/org/${orgId}/`)
        .then(responseData => callback(null, responseData))
        .catch(callback);
    },
    (spaces, callback) => {
      async.each(spaces, (space, callback) => {
        const spacePath = path.join(orgPath, `${space.name}`);
        async.parallel({
          [`${space.name}.json`]: (callback) => {
            persistData(spacePath, `${space.name}.json`, space, callback);
          },
          [`${space.name}-apps`]: (callback) => {
            orgSummary[space.name] = {};
            exporter.retrieveApps(space.space_id, spacePath, orgSummary[space.name], callback);
          }
        }, callback);
      }, callback);
    }
  ], callback);
};

exporter.retrieveApps = (spaceId, spacePath, spaceSummary, callback) => {
  async.waterfall([
    (callback) => {
      exporter.podio.request('GET', `/app/space/${spaceId}/`)
        .then(responseData => callback(null, responseData))
        .catch(callback);
    },
    (apps, callback) => {
      async.each(apps, (app, callback) => {
        const appPath = path.join(spacePath, `${app.config.name}`);
        spaceSummary[app.config.name] = {};
        async.parallel({
          [`${app.config.name}.json`]: (callback) => {
            persistData(appPath, `${app.config.name}.json`, app, callback);
          },
          [`${app.config.name}-items`]: (callback) => {
            exporter.retrieveItems(app.app_id, appPath, spaceSummary[app.config.name], callback);
          },
          [`${app.config.name}-files`]: (callback) => {
            exporter.retrieveFiles(`/file/app/${app.app_id}/`, appPath, spaceSummary[app.config.name], callback);
          }
        }, callback);
      }, callback);
    }
  ], callback);
};

const buildRange = (offset, count) => `${offset+1}-${offset+count}`;

exporter.retrieveItems = (appId, appPath, appSummary, callback) => {
  const limit = 500; // TODO: move to config
  const itemsFilename = (offset, count) => `items_${buildRange(offset, count)}.json`;

  const calculateOffsets = (responseSize, totalSize, limit) => {
    const offsets = [];

    for (var i = responseSize; i < totalSize; i += limit) {
      offsets.push(i);
    }
    return offsets;
  };

  async.waterfall([
    (callback) => {
      exporter.limiter.removeTokens(1, () => {
        const offset = 0;
        exporter.podio.request('POST', `/item/app/${appId}/filter/`, { offset, limit })
          .then(responseData => {
            appSummary[NUM_ITEMS] = responseData.items.length;
            appSummary[TOTAL_ITEMS] = responseData.total;
            if (responseData.items.length > 0) {
              persistData(appPath, itemsFilename(offset, responseData.items.length), responseData, (err) => {
                callback(err, calculateOffsets(responseData.items.length, responseData.total, limit));
              });
            } else callback(null, []);
          })
          .catch(callback);
      });
    },
    (offsets, callback) => {
      async.eachLimit(offsets, exporter.config.EACH_LIMIT, (offset, callback) => {
        exporter.limiter.removeTokens(1, () => {
          exporter.podio.request('POST', `/item/app/${appId}/filter/`, { offset, limit })
            .then(responseData => {
              appSummary[NUM_ITEMS] += responseData.items.length;
              if (appSummary[TOTAL_ITEMS] !== responseData.total) {
                callback(new Error('Items might have been created/deleted while exporting. Aborting!'));
              }
              persistData(appPath, itemsFilename(offset, responseData.items.length), responseData, callback);
            })
            .catch(callback);
        });
      }, callback);
    }
  ], callback);
};

exporter.retrieveTasks = (orgId, orgPath, orgSummary, callback) => {
  const limit = 100; // TODO: move to config
  const tasksFilename = (offset, count) => `tasks_${buildRange(offset, count)}.json`;
  var offset = 0;
  var responseSize = limit;
  orgSummary.numTasks = 0;

  async.whilst(
    () => responseSize === limit,
    (callback) => {
      exporter.limiter.removeTokens(1, () => {
        exporter.podio.request('GET', '/task/', { org: orgId, offset, limit })
          .then(responseData => {
            responseSize = responseData.length;
            orgSummary.numTasks += responseSize;
            if (responseSize > 0) {
              persistData(orgPath, tasksFilename(offset, responseSize), responseData, (err) => {
                offset += limit;
                callback(err);
              });
            } else callback(null);
          })
          .catch(callback);
      });
    },
    callback);
};

exporter.retrieveFiles = (url, path, summary, callback) => {
  const limit = 100; // TODO: move to config
  const filesFilename = (offset, count) => `files_${buildRange(offset, count)}.json`;
  var offset = 0;
  var responseSize = limit;
  summary[NUM_FILES] = 0;
  summary[DOWNLOADED_FILES] = 0;

  async.whilst(
    () => responseSize === limit,
    (callback) => {
      exporter.podio.request('GET', url, { offset, limit })
        .then(responseData => {
          responseSize = responseData.length;
          summary[NUM_FILES] += responseSize;
          if (responseSize > 0) {
            async.parallel({
              ['files_X-Y.json']: (callback) => {
                persistData(path, filesFilename(offset, responseSize), responseData, (err) => {
                  offset += limit;
                  callback(err);
                });
              },
              ['./files']: (callback) => {
                exporter.downloadFiles(responseData, path, summary, callback);
              }
            }, callback);
          } else callback(null);
        })
        .catch(callback);
    },
    callback);
};

exporter.downloadFiles = (files, basePath, summary, callback) => {
  if (!shouldDownloadFiles()) return callback(null);
  const filePath = path.join(basePath, 'files');
  fse.ensureDir(filePath)
    .then(() => {
      async.eachLimit(files, exporter.config.EACH_LIMIT, (file, callback) => {
        const filename = path.format({
          dir: filePath,
          name: file.file_id,
          ext: `.${mime.getExtension(file.mimetype)}`
        });
        exporter.downloadFile(file.link, filename, (err) => {
          if (!err) summary[DOWNLOADED_FILES] += 1;
          callback(err);
        });
      }, callback);
    })
    .catch(callback);
};

exporter.retrieveContacts = (path, summary, callback) => {
  const limit = 500; // TODO: move to config
  const contactsFilename = (offset, count) => `contacts_${buildRange(offset, count)}.json`;
  var offset = 0;
  var responseSize = limit;
  summary.numContacts = 0;

  async.whilst(
    () => responseSize === limit,
    (callback) => {
      exporter.podio.request('GET', '/contact/', { offset, limit })
        .then(responseData => {
          responseSize = responseData.length;
          summary.numContacts += responseSize;
          if (responseSize > 0) {
            persistData(path, contactsFilename(offset, responseSize), responseData, (err) => {
              offset += limit;
              callback(err);
            });
          } else callback(null);
        })
        .catch(callback);
    },
    callback);
};

exporter.downloadFile = (url, filename, callback) => {
  exporter.limiter.removeTokens(1, () => {
    // https://stackoverflow.com/questions/38130128/podio-file-attached-to-item-cannot-be-downloaded
    download(`${url}?oauth_token=${exporter.podio.authObject.accessToken}`)
      .pipe(fs.createWriteStream(filename))
      .on('warning', (err) => {
        // good practice to catch warnings (ie stat failures and other non-blocking errors)
        if (err.code === 'ENOENT') {
          // log warning
          console.warn(err);
        } else callback(err);
      })
      .on('error', callback)
      .on('finish', () => {
        callback(null);
        console.log(`Downloaded ${filename.replace(`${__dirname}/`, '')}`);
      });
  });
};

module.exports = exporter;

/* eslint-env node */
'use strict';

const ORG_ID = 123;
const SPACE_ID = 456;
const APP_ID = 789;

module.exports = {
  authObject: {accessToken: 'dummy'},
  request: (method, path) => {
    return new Promise((resolve, reject) => {
      switch (path) {
      case '/org/':
        resolve([{
          name: 'myOrg',
          org_id: ORG_ID
        }]);
        break;
      case `/space/org/${ORG_ID}/`:
        resolve([{
          name: 'myWorkspace',
          space_id: SPACE_ID
        }]);
        break;
      case `/app/space/${SPACE_ID}/`:
        resolve([{
          config: { name: 'myApp' },
          app_id: APP_ID
        }]);
        break;
      case `/item/app/${APP_ID}/filter/`:
        resolve({
          items: [
            {item: 1},
            {item: 2},
          ],
          total: 2
        });
        break;
      case '/task/':
        resolve([
          {task: 1},
          {task: 2},
        ]);
        break;
      case `/file/app/${APP_ID}/`:
        resolve([
          {
            file_id: 1,
            link: 'https://s3.amazonaws.com/node-alexa-smapi/icons/icon_108_A2Z.png',
            mimetype: 'image/png',
          },
          {
            file_id: 2,
            link: 'https://s3.amazonaws.com/node-alexa-smapi/icons/icon_108_A2Z.png',
            mimetype: 'image/png',
          },
        ]);
        break;
      case '/mockFile/':
        resolve({
          file: 1,
        });
        break;
      case '/contact/':
        resolve([
          {contact: 1},
          {contact: 2},
        ]);
        break;
      default:
        console.log(path); // eslint-disable-line no-console
        reject({});
      }
    });
  }
};

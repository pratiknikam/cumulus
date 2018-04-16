/* eslint-disable no-param-reassign */
/* this module is intended to be used for bootstraping
 * the cloudformation deployment of a DAAC.
 *
 * The module is invoked by CloudFormation as custom resource
 * more info: http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
 *
 * It helps:
 *  - adding ElasticSearch index mapping when a new index is created
 *  - creating API users
 *  - encrypting CMR user/pass and adding it to configuration files
 */

'use strict';

const got = require('got');
const url = require('url');
const get = require('lodash.get');
const log = require('@cumulus/common/log');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { justLocalRun } = require('@cumulus/common/local-helpers');
const Manager = require('../models/base');
const { Search, defaultIndexAlias } = require('../es/search');
const mappings = require('../models/mappings.json');
const physicalId = 'cumulus-bootstraping-daac-ops-api-deployment';

/**
 * Initialize elastic search. If the index does not exist, create it with an alias.
 * If an index exists but is not aliased, alias the index.
 *
 * @param {string} host - elastic search host
 * @param {string} index - name of the index to create if does not exist, defaults to 'cumulus'
 * @param {string} alias - alias name for the index, defaults to 'cumulus'
 * @returns {Promise} undefined
 */
async function bootstrapElasticSearch(host, index = 'cumulus', alias = defaultIndexAlias) {
  if (!host) {
    return;
  }

  const esClient = await Search.es(host);

  // check if the index exists
  const exists = await esClient.indices.exists({ index });

  if (!exists) {
    // add mapping
    await esClient.indices.create({
      index,
      body: { mappings }
    });

    await esClient.indices.putAlias({
      index: index,
      name: alias
    });

    log.info(`index ${index} created with alias ${alias} and mappings added.`);
  }
  else {
    const aliasExists = await esClient.indices.existsAlias({
      name: alias
    });

    if (!aliasExists) {
      await esClient.indices.putAlias({
        index: index,
        name: alias
      });

      log.info(`Created alias ${alias} for index ${index}`);
    }

    log.info(`index ${index} already exists`);
  }
}

/**
 * Add users to the cumulus user table
 *
 * @param {string} table - dynamodb table name
 * @param {Array} records - array of user records
 * @returns {Promise.<Array>} array of aws dynamodb responses
 */
async function bootstrapUsers(table, records) {
  if (!table) {
    return new Promise((resolve) => resolve());
  }
  const user = new Manager(table);

  // delete all user records
  const existingUsers = await user.scan();
  await Promise.all(existingUsers.Items.map((u) => user.delete({ userName: u.userName })));
  // add new ones
  const additions = records.map((record) => user.create({
    userName: record.username,
    password: record.password,
    createdAt: Date.now()
  }));

  return Promise.all(additions);
}

/**
 * Encrypt CMR password
 *
 * @param {string} password - plain text cmr password
 * @returns {Promise.<string>} encrypted cmr password
 */
async function bootstrapCmrProvider(password) {
  if (!password) {
    return new Promise((resolve) => resolve('nopassword'));
  }
  return DefaultProvider.encrypt(password);
}

/**
 * Sends response back to CloudFormation
 *
 * @param {Object} event - AWS lambda event object
 * @param {string} status - type of response e.g. success, failure
 * @param {Object} data - response data
 * @returns {Promise} - AWS CloudFormation response
 */
async function sendResponse(event, status, data = {}) {
  const body = JSON.stringify({
    Status: status,
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  log.info('RESPONSE BODY:\n', body);
  log.info('SENDING RESPONSE...\n');

  const r = await got.put(event.ResponseURL, {
    body,
    headers: {
      'content-type': '',
      'content-length': body.length
    }
  });
  log.info(r.body);
}

/**
 * CloudFormation custom resource handler
 *
 * @param {Object} event - AWS Lambda event input
 * @param {Object} context - AWS Lambda context object
 * @param {Function} cb - AWS Lambda callback
 * @returns {Promise} undefined
 */
function handler(event, context, cb) {
  const es = get(event, 'ResourceProperties.ElasticSearch');
  const users = get(event, 'ResourceProperties.Users');
  const cmr = get(event, 'ResourceProperties.Cmr');
  const requestType = get(event, 'RequestType');

  if (requestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', null).then((r) => cb(null, r));
  }

  const actions = [
    bootstrapElasticSearch(get(es, 'host')),
    bootstrapUsers(get(users, 'table'), get(users, 'records')),
    bootstrapCmrProvider(get(cmr, 'Password'))
  ];

  return Promise.all(actions)
    .then((results) => {
      const data = {
        CmrPassword: results[2]
      };

      return sendResponse(event, 'SUCCESS', data);
    })
    .then((r) => cb(null, r))
    .catch((e) => {
      log.error(e);
      return sendResponse(event, 'FAILED', null);
    })
    .then((r) => cb(null, r));
}

module.exports = {
  handler,
  bootstrapElasticSearch
};

justLocalRun(() => {
  //const a = {};
  //handler(a, {}, (e, r) => console.log(e, r));
  //bootstrapCmrProvider('testing').then(r => {
  //console.log(r)
  //return DefaultProvider.decrypt(r)
  //}).then(r => console.log(r))
  //.catch(e => console.log(e));
});

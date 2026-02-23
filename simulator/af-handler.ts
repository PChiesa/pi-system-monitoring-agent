import http from 'http';
import { AFModel, type AFDatabase, type AFElement, type AFAttribute } from './af-model.js';
import { DataGenerator } from './data-generator.js';
import { sendJson } from './utils.js';

function selfUrl(req: http.IncomingMessage, path: string): string {
  const host = req.headers.host || 'localhost';
  return `https://${host}${path}`;
}

function formatDatabase(db: AFDatabase, req: http.IncomingMessage) {
  return {
    WebId: db.webId,
    Id: db.id,
    Name: db.name,
    Description: db.description,
    Path: db.path,
    Links: {
      Self: selfUrl(req, `/piwebapi/assetdatabases/${db.webId}`),
      Elements: selfUrl(req, `/piwebapi/assetdatabases/${db.webId}/elements`),
    },
  };
}

function formatElement(el: AFElement, req: http.IncomingMessage) {
  return {
    WebId: el.webId,
    Id: el.id,
    Name: el.name,
    Description: el.description,
    Path: el.path,
    HasChildren: el.children.length > 0,
    Links: {
      Self: selfUrl(req, `/piwebapi/elements/${el.webId}`),
      Attributes: selfUrl(req, `/piwebapi/elements/${el.webId}/attributes`),
      Elements: selfUrl(req, `/piwebapi/elements/${el.webId}/elements`),
      Database: selfUrl(req, `/piwebapi/assetdatabases/${el.databaseWebId}`),
      ...(el.parentWebId ? { Parent: selfUrl(req, `/piwebapi/elements/${el.parentWebId}`) } : {}),
    },
  };
}

function formatAttribute(attr: AFAttribute, req: http.IncomingMessage) {
  return {
    WebId: attr.webId,
    Id: attr.id,
    Name: attr.name,
    Description: attr.description,
    Path: attr.path,
    Type: attr.type,
    DefaultUnitsOfMeasure: attr.defaultUOM,
    DataReferencePlugIn: attr.dataReference,
    ConfigString: attr.piPointName ? `\\\\${attr.piPointName}` : '',
    Links: {
      Self: selfUrl(req, `/piwebapi/attributes/${attr.webId}`),
      Value: selfUrl(req, `/piwebapi/attributes/${attr.webId}/value`),
      Element: selfUrl(req, `/piwebapi/elements/${attr.elementWebId}`),
    },
  };
}

export function createAFHandler(
  afModel: AFModel,
  generator: DataGenerator
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  return function handleAF(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url!, `https://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // GET /piwebapi/assetdatabases
    if (path === '/piwebapi/assetdatabases' && req.method === 'GET') {
      const dbs = afModel.getDatabases().map((db) => formatDatabase(db, req));
      sendJson(res, 200, { Items: dbs, Links: {} });
      return true;
    }

    // GET /piwebapi/assetdatabases/:webId
    const dbMatch = path.match(/^\/piwebapi\/assetdatabases\/([^/]+)$/);
    if (dbMatch && req.method === 'GET') {
      const db = afModel.getDatabase(dbMatch[1]!);
      if (!db) {
        sendJson(res, 404, { Message: 'Asset database not found', Errors: [] });
        return true;
      }
      sendJson(res, 200, formatDatabase(db, req));
      return true;
    }

    // GET /piwebapi/assetdatabases/:webId/elements
    const dbElementsMatch = path.match(/^\/piwebapi\/assetdatabases\/([^/]+)\/elements$/);
    if (dbElementsMatch && req.method === 'GET') {
      const elements = afModel.getRootElements(dbElementsMatch[1]!);
      sendJson(res, 200, { Items: elements.map((el) => formatElement(el, req)), Links: {} });
      return true;
    }

    // GET /piwebapi/elements/:webId
    const elementMatch = path.match(/^\/piwebapi\/elements\/([^/]+)$/);
    if (elementMatch && req.method === 'GET') {
      const el = afModel.getElement(elementMatch[1]!);
      if (!el) {
        sendJson(res, 404, { Message: 'Element not found', Errors: [] });
        return true;
      }
      sendJson(res, 200, formatElement(el, req));
      return true;
    }

    // GET /piwebapi/elements/:webId/elements
    const childElementsMatch = path.match(/^\/piwebapi\/elements\/([^/]+)\/elements$/);
    if (childElementsMatch && req.method === 'GET') {
      const children = afModel.getChildElements(childElementsMatch[1]!);
      sendJson(res, 200, { Items: children.map((el) => formatElement(el, req)), Links: {} });
      return true;
    }

    // GET /piwebapi/elements/:webId/attributes
    const elementAttrsMatch = path.match(/^\/piwebapi\/elements\/([^/]+)\/attributes$/);
    if (elementAttrsMatch && req.method === 'GET') {
      const attrs = afModel.getAttributes(elementAttrsMatch[1]!);
      sendJson(res, 200, { Items: attrs.map((a) => formatAttribute(a, req)), Links: {} });
      return true;
    }

    // GET /piwebapi/attributes/:webId
    const attrMatch = path.match(/^\/piwebapi\/attributes\/([^/]+)$/);
    if (attrMatch && req.method === 'GET') {
      const attr = afModel.getAttribute(attrMatch[1]!);
      if (!attr) {
        sendJson(res, 404, { Message: 'Attribute not found', Errors: [] });
        return true;
      }
      sendJson(res, 200, formatAttribute(attr, req));
      return true;
    }

    // GET /piwebapi/attributes/:webId/value
    const attrValueMatch = path.match(/^\/piwebapi\/attributes\/([^/]+)\/value$/);
    if (attrValueMatch && req.method === 'GET') {
      const attr = afModel.getAttribute(attrValueMatch[1]!);
      if (!attr) {
        sendJson(res, 404, { Message: 'Attribute not found', Errors: [] });
        return true;
      }
      if (!attr.piPointName) {
        sendJson(res, 200, {
          Timestamp: new Date().toISOString(),
          Value: null,
          UnitsAbbreviation: attr.defaultUOM,
          Good: false,
          Questionable: true,
          Substituted: false,
          Annotated: false,
        });
        return true;
      }
      const value = generator.getCurrentValue(attr.piPointName);
      if (!value) {
        sendJson(res, 404, { Message: `No data for PI Point "${attr.piPointName}"`, Errors: [] });
        return true;
      }
      sendJson(res, 200, value);
      return true;
    }

    return false;
  };
}

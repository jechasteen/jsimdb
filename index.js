/**
 * JavaScript Local Database, Relational
 * @module relational
 */

const fs = require('fs');
const path = require('path');
const baseDir = path.dirname(require.main.filename);
const { exec, execSync } = require('child_process');

const supportedTypes = ['number', 'string', 'date'];

// Holds the database in memory once we have either created or loaded from file.
let db = {};
// Holds the path to the database JSON file
db.path = undefined;
exports.path = function () {
    return db.path;
};
// Holds the autosave option passed at database creation, default false. Also set after connecting to an existing db
db.autosave = false;

const uuidQueue = (function () {
    const uuids = [];

    function handleOutput(err, stdout, stderr) {
        if (err) {
            console.log(err);
        }
        uuids.push(stdout.replace('\n', ''));
    }

    // TODO: Maybe this should be set via process.env?
    for (var i = 0; i < 2; i++)
        uuids.push(execSync('uuidgen', { encoding: 'utf8' }).replace('\n', ''));

    return {
        get: function () {
            exec('uuidgen', handleOutput);
            return uuids.shift();
        },
    };
})();

/**
 * Checks the fields object for errors. If successful, the first parameter passed will be true, and the second will contain
 * a verified object. If it fails, it will return false as the first parameter, and the failed type text as a string.
 * Note: this function was intended to be called when a new database is created.
 * @param {object} unverifiedTables - A schema object used to create and verify db entries. This object is passed to create()
 * @param {function} cb - Function has the arguments (result: boolean, [failedType: string || passedTable: object])
 */
const verifyTables = (unverifiedTables, cb) => {
    const tables = [];

    for (let key in unverifiedTables) {
        tables.push(key);
    }

    tables.forEach((t) => {
        let curTable = unverifiedTables[t];
        for (let k in curTable) {
            const s = curTable[k].type.split(' ');
            const f = curTable[k];
            if (s.length === 1) {
                // type is basic
                if (supportedTypes.indexOf(f.type) < 0) {
                    cb(false, f.type);
                } else {
                    continue;
                }
            } else if (s.length === 2) {
                // either "array ${type}" or "id ${table}"
                if (s[0] === 'id') {
                    if (tables.indexOf(s[1]) < 0) {
                        return cb(false, f.type);
                    } else {
                        continue;
                    }
                } else if (s[0] === 'array') {
                    if (supportedTypes.indexOf(s[1]) < 0) {
                        return cb(false, f.type);
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            } else if (s.length === 3) {
                // "array id ${table}"
                if (tables.indexOf(s[2]) < 0) {
                    cb(false, f.type);
                } else {
                    continue;
                }
            }
        }
    });

    cb(true, unverifiedTables);
};

/**
 * Initialize a new database.
 * This should be done with a new require() call for each database to be created.
 * @example
 * let db1 = require('jsldb')
 * db1.create('db1', db1schema, true);
 * let db2 = require('jsldb');
 * db2.create('db2, db2schema, false);
 * @param {string} name - The name of the new database
 * @param {Object} schema - A [tables]{@link docs/tables} schema object
 * @param {boolean} autosave - Whether to save automatically at creation and on changes, default false
 * @throws if the database given already exists, or if table verification returns a check error.
 * @returns {boolean} - true if the database creation completed successfully. Undefined otherwise.
 */
exports.create = (name, schema, autosave = false) => {
    db.path = path.join(baseDir, `${name}.db.json`);
    const dbFilename = name + '.db.json';
    if (fs.existsSync(db.path)) {
        throw new Error(`Database ${name} already exists`);
    } else {
        db.autosave = autosave;
        verifyTables(schema, (res, data) => {
            if (!res) {
                throw new Error(
                    `Type given, ${data}, does not conform to a supported type.`
                );
            } else {
                db.schemas = data;
                db.tables = {};
                for (let key in data) {
                    db.schemas[key].count = 0;
                    db.tables[key] = {};
                }
            }
        });
    }
    return true;
};

/**
 * Connect to an existing database. Function expects just the "name" of the database as an abbreviation of the
 * filename name.db.json which this function will attempt to load.
 * @example
 * let db = require('jsldb');
 * db.connect('db');
 * @param {string} name - The name of the database to be loaded
 * @throws if the database given does not exist
 */
exports.connect = (name) => {
    db.path = path.join(baseDir, `${name}.db.json`);
    console.log('PATH', db.path);
    if (fs.existsSync(db.path)) {
        try {
            db = JSON.parse(fs.readFileSync(db.path));
            if (db.path === db.path) {
                return true;
            } else {
                return false;
            }
        } catch (e) {
            console.log(`Failed to load db from ${db.path}: ${e}`);
        }
    } else {
        throw new Error(`Database ${name} does not exist`);
    }
};

const checkField = (type, value) => {
    const valid = {
        number: (val) => {
            return typeof val === 'number';
        },
        string: (val) => {
            return typeof val === 'string';
        },
        date: (val) => {
            return val instanceof Date;
        },
    };

    const s = type.split(' ');

    if (!type || !value) {
        return false; // we know by the point this function is called values must exist for both parameters
    }

    if (s.length === 1) {
        // Simple type
        if (valid[type] && valid[type](value)) return true;
        else return false;
    } else if (
        s[0] === 'array' &&
        s[1] !== 'id' &&
        supportedTypes.indexOf(s[1]) >= 0
    ) {
        if (value.length == 0) return true;
        // s[0] = 'array', s[1] 'type'
        const memberType = s[1];
        try {
            value.forEach((v) => {
                if (!valid[memberType](v)) {
                    return false;
                }
            });
            return true;
        } catch (e) {
            return false;
        }
    } else if (s[0] === 'array' && s[1] === 'id') {
        // s[0] = 'array', s[1] = 'id', s[2] = 'table'
        if (!db.tables[s[2]]) {
            throw new Error(`Referenced table ${s[2]} does not exist.`);
        } else {
            if (value instanceof Array) {
                value.forEach((v) => {
                    if (!db.tables[s[2]][value]) {
                        return false;
                    }
                });
                return true;
            } else {
                // single value
                if (!db[s[2][value]]) {
                    return false;
                } else {
                    return true;
                }
            }
        }
    } else if (s[0] === 'id') {
        if (!db.tables[s[1]]) {
            throw new Error(`Referenced table ${s[1]} does not exist.`);
        } else {
            if (db.tables[s[1]][value]) {
                return true;
            }
        }
    } else {
        return false;
    }
};

/**
 * Add a new entry to a table.
 * The `_id` is a UUID and is created automatically.
 * @param {string} table - The name of the table to add to.
 * @param {Object} entry - An object that conforms to the schema specified in the tables object
 * @param {function} cb - Callback function. An error only if the check failed, or false first parameter and the newly created entry as the second.
 * @returns {boolean} - The result of the insertion operation. A check error if the check failed, or false if not.
 * @throws if the type check fails.
 */
exports.insert = (table, entry, cb = () => {}) => {
    const schema = db.schemas[table];

    for (let k in entry) {
        if (!checkField(schema[k].type, entry[k])) {
            console.log(`failed schema`);
            throw new Error(`Field Check failed for table ${table}, key ${k} value ${entry[k]}`);
        } else {
            continue;
        }
    }

    const id = uuidQueue.get();
    db.tables[table][id] = entry;
    db.tables[table][id]._id = id;

    if (db.autosave) {
        exports.save();
    }

    cb(true, db.tables[table][id]);
    return false;
};

/**
 * Overwrite the value for an existing field in the entry matching id.
 * @param {string} table - The table to be searched
 * @param {number} id - The id to be selected
 * @param {string} field - The field to be overwritten
 * @param {any} value - The value to be written. Must conform to schema.
 * @param {function} cb - A callback to be run after the set operation. The first parameter is success/failure. The second is the table entry written or null.
 * @returns {boolean} - The result of the set operation.
 */
exports.setFieldById = (table, id, field, value, cb = () => {}) => {
    // TODO: The callback has a pointless first parameter because it's being reserved
    //       for an error object in the future. Maybe some other value.
    if (checkField(db.schemas[table][field].type, value)) {
        if (db.tables[table].hasOwnProperty(id)) {
            db.tables[table][id][field] = value;
            cb(true, db.tables[table][id]);
        } else {
            console.log(`${id} does not exist in ${table}.`);
            cb(false, null);
        }
        if (db.autosave) {
            exports.save();
        }
        return true;
    } else {
        cb(false, null);
        return false;
    }
};

/**
 * Delete an entry by id.
 * @param {string} table - The table to be targeted
 * @param {number} id - The id of the entry to be deleted
 * @param {callback} cb - A callback function passed the deletion result and the id that was deleted
 */
exports.delete = (table, id, cb = () => {}) => {
    let result = delete db.tables[table][id];
    if (result) {
        cb(true, id);
    } else {
        cb(false, id);
    }
    if (db.autosave) {
        exports.save();
    }
};

/**
 * Fetch an entry by its id
 * @param {string} table - The table to be targeted
 * @param {number} id - The id of the entry to be retrieved
 * @param {function} cb - Callback function. First parameter is the result of the operation (true|false), second is
 * the entry that was retrieved
 * @returns {object} - The object which was found, or, if not found, undefined;
 */
exports.findById = (table, id, cb = () => {}) => {
    if (typeof cb !== 'function')
        throw new Error('Callback parameter to findById does not have type function.');
    const found = db.tables[table][parseInt(id)];
    if (found) {
        cb(true, found);
    } else {
        cb(false, id);
    }
    return found;
};

/**
 * Fetch the whole tables object
 * @param {function} cb - Callback function passed the full database object as a parameter
 * @returns {Object} - The full database object
 */
exports.tables = (cb) => {
    if (typeof cb === 'function') {
        cb(true, db.tables);
    }

    return db.tables;
};

db.fileExists = false;

function duplicateFileIfExists() {
    if (db.fileExists || fs.existsSync(db.path)) {
        fs.copyFileSync(db.path, path.join(db.path + '.old'));
    }
}

/**
 * Asynchronously write the database object in memory to file
 * @async
 * @param {function} cb An optional callback with one parameter (error?) that runs after the write operation.
 */
exports.save = function (cb) {
    duplicateFileIfExists();

    const dbJSON = JSON.stringify(db);
    if (typeof cb === 'function') {
        fs.writeFile(db.path, dbJSON, { encoding: 'utf8' }, cb);
        db.fileExists = fs.existsSync(db.path);
    } else {
        fs.writeFile(db.path, dbJSON, { encoding: 'utf8' }, () => {
            if (err) throw new Error(`Failed to save ${db.path}: err`);
            else {
                console.log(`Sucessfully saved ${db.path}`);
                db.fileExists = fs.existsSync(db.path);
            }
        });
    }
};

/**
 * Synchronously write the database object in memory to file
 * @returns {boolean} - The result of the operation.
 */

exports.saveSync = function () {
    duplicateFileIfExists();

    const dbJSON = JSON.stringify(db);
    fs.writeFileSync(db.path, dbJSON, { encoding: 'utf8' });
    if ((db.fileExists = fs.existsSync(db.path))) {
        console.log(`Successfully wrote ${db.path}`);
        return true;
    } else {
        console.log(`Failed to write ${db.path}`);
        return false;
    }
};

/**
 * Find all items in a table with given field matching value.
 * @example
 * let jonses = db.findAll('people', 'firstname', 'Jon');
 * jonses.forEach( (jon) => {
 *     console.log(`${jon.firstname} ${jon.lastname} is a jerk.`);
 * }); 
 * @param {string} table - The name of the table to be searched
 * @param {field} field - The field to find
 * @param {value} value - The value that must match
 * @returns {Object[]} - All matching objects
 */
function findAll(table, field, value) {
    let ret = [];
    for (key in table) {
        if (table[key][field] === value) {
            ret.push(table[key]);
        }
    }
    return ret;
}

/**
 * Query a table using query object. Finds ALL matching entries
 * The currently supported query type is `fieldName: 'valueToMatch'`
 * Caveat: does not exactly support `date: [Date object]`
 * @example
 * let james = db.find('people', { name: "Jame" });
 * james.forEach( (jame) => {
 *     console.log(`${jame.firstname} ${jame.lastname} has a great head of hair.`);
 * });
 * @param {string} tableName - The name of the table to be queried
 * @param {object} query - An object composed of the `field: value` pairs to be matched
 * @param {function} cb - A callback. If the query was successful (even if the results are empty), the first parameter will be true, if there was an error in the query it will be false.
 * the second parameter will be the found entries as an array (or undefined if none), or if there was an error a string describing the error.
 */
exports.find = (tableName, query, cb) => {
    if (query === {}) {
        cb(db.tables[tableName]);
    }

    const fields = (() => {
        let f = [];
        for (let key in db.schemas[tableName]) {
            f.push(key);
        }
        return f;
    })();

    for (let key in query) {
        if (fields.indexOf(key) > -1) {
            const results = findAll(db.tables[tableName], key, query[key]);
            if (results.length > 0) {
                cb(true, results);
            } else {
                cb(true, undefined);
            }
        } else {
            cb(
                false,
                `Query table name does not exist, table: ${tableName}, field ${key}`
            );
        }
    }
};

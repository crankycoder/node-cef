const util = require('util');
const validatorForKey = require('./extensions').validatorForKey;

const CURRENT_CEF_VERSION = "0";
const requiredParams = ['vendor', 'product', 'version', 'signature', 'name', 'severity'];

// RegExp objects for the formatter below
const SPECIAL_CHARS = new RegExp("([^\\\\])([\\|=])", "gm");
const INITIAL_SPECIAL_CHARS = new RegExp("^([\\|=])");
const NEWLINE_CHARS = new RegExp("([\r\n]+)", "gm");

var Formatter = module.exports = function Formatter(config) {
  config = config || {};

  // Set default config for vendor, product, version
  this.vendor = config.vendor || "";
  this.product = config.product || "";
  this.version = config.version || "";

  return this;
};

Formatter.prototype = {
  /**
   * Convert a string to a legal CEF string
   *
   * @param text
   *        (string)    The text to filter
   *
   * The CEF v0 spec requires that:
   *
   * - pipes, backslashes, and equals signs in keys/values be escaped
   *
   * - newline character be either \r or \n, but not both.  Given the
   *   choice, we choose \n.
   *
   * This function is idempotent; when called on its own output, the
   * output will not be modified further.
   */
  sanitizeText: function sanitizeText(text) {
    if (typeof text === 'undefined' || typeof text === 'null') {
      text = typeof text;
    }

    else if (typeof text === 'object') {
      text = JSON.stringify(text, null, 2);
    }

    // Make it a string
    else text = text.toString();

    // Escape pipes, backslashes, and equals signs that have not
    // already been escaped.
    text = text.replace(SPECIAL_CHARS, "$1\\$2");

    // Escape any pipes, backslashes, and equals signs at the
    // beginning of the string
    text = text.replace(INITIAL_SPECIAL_CHARS, "\\$1");

    // Convert all newlines to \n
    text = text.replace(NEWLINE_CHARS, "\n");

    return text;
  },

  /**
   * Format a string to be used as a key in a list of extensions
   *
   * @param key
   *        (string)    The string to format
   *
   * Returns an escaped and formatted string.
   *
   * The CEF spec does not dictate the form of keys for extended
   * parameters beyond the implication that they may not contain
   * spaces.
   */
  filterKey: function filterKey(key) {
    // make it a string
    key = this.sanitizeText(key);
    key = key.replace(/\s+/gm, "_");
    if (key.length > 1023) {
      key = key.slice(0, 1023);
    }
    return key;
  },

  /**
   * Format a string to be used as a value in a list of extensions.
   *
   * @param value
   *        (string)   The string to format
   *
   * Returns escaped and formatted string.
   */
  filterValue: function filterValue(value) {
    // make it a string
    value = this.sanitizeText(value);
    if (value.length > 1023) {
      value = value.slice(0, 1023);
    }
    return value;
  },

  /**
   * Format log message extensions
   *
   * @param extensions
   *        (object)    A dictionary of key/value pairs to format
   *
   * Returns a string like "key1=value1 key2=value2".  Whitespace in
   * values is preserved (with some possible modification of
   * newlines).
   */
  formatExtensions: function formatExtensions(extensions) {
    if (typeof extensions !== 'object') {
      return '';
    }

    // Convert extensions dictionary to a string like "food=pie barm=42"
    var extensionArray = [];
    var value = "";
    var validator = null;
    Object.keys(extensions).forEach(function(key) {
      key = this.filterKey(key);
      validator = validatorForKey(key);
      if (validator) {
        value = this.filterValue(extensions[key]);
        if (validator(value)) {
          extensionArray.push(util.format("%s=%s",
                                          this.filterKey(key),
                                          this.filterValue(extensions[key])));
        } else {
          console.error(util.format("Not a valid value for %s: %s", key, value));
        }
      } else {
        console.error("Not a valid CEF or ArcSight key: " + key);
      }
    }.bind(this));
    return extensionArray.join(" ");
  },

  /*
   * Accept set of prefix values and a set of extensions.  On error,
   * return an error object.  Otherwise return null and a formatted CEF
   * string.
   *
   * @param prefix
   *        (object)  A dictionary containing the six required prefix fields
   *                  and optional extensions dictionary.  The fields are:
   *
   *                  {cef_version: <integer version of the CEF format; default 0>,
   *                   vendor:      <string>,
   *                   product:     <string>,
   *                   version:     <string>,
   *                   signature:   <arbitrary event identifier>,
   *                   name:        <human-readable description of the event>,
   *                   severity:    <integer between 0 and 10 (least to most important)>}
   *
   * @param extensions
   *        (object)   Optional dictionary of additional key-value pairs.
   *
   * Vendor, product, and version should be unique.
   *
   * The resulting message will formatted with a pipe ("|") separating
   * each field in the prefix, and spaces separating each key-value pair
   * in the extensions, which will be joined with an equals sign ("=").
   *
   * For example:
   *
   *   format({vendor: "FooTech",
   *           product: "Frobulator",
   *           version: "42",
   *           signature: "1337",
   *           name: "Unmatched sock detected",
   *           severity: 6,
   *           extensions: {
   *             color: "red",
   *             size: "M",
   *           }});
   *
   * Would return:
   *
   *   "CEF:0|FooTech|Frobulator|42|1337|Unmatched sock detected|6|color=red size=M"
   *
   * In CEF lingo, the part of the string that does not include any
   * extended params is called the prefix.
   *
   */
  format: function format(params) {
    var err = null;
    var extensions = params.extensions;

    // If none supplied, use default vendor, product, version
    if (! (params.vendor && params.product && params.version)) {
      params.vendor = this.vendor;
      params.product = this.product;
      params.version = this.version;
    }

    // Sanitize params
    Object.keys(params).forEach(function(key) {
      params[key] = this.filterValue(params[key]);
    }.bind(this));

    // Check that required params are present and contain a value.
    // If not, return an error.
    var paramKeys = Object.keys(params);
    requiredParams.forEach(function checkRequiredKeys(requiredKey) {
      if (paramKeys.indexOf(requiredKey) === -1) {
        err = new Error(util.format("Missing required key '%s' from params",
                                    requiredKey));
      }
    });
    if (err) {
      return (err);
    }

    // Check that severity is between 0 and 10.
    // If not, return an error.
    params.severity = parseInt(params.severity, 10);
    if (params.severity < 0 || params.severity > 10) {
      return new Error(util.format("Illegal severity value: '%d'; must be [0..10]",
                                   params.severity));
    }

    var prefix = util.format("CEF:%s|%s|%s|%s|%s|%s|%s",
      CURRENT_CEF_VERSION,
	  params.vendor,
      params.product,
      params.version,
      params.signature,
      params.name,
      params.severity);

    if (extensions) {
      return null, [prefix, this.formatExtensions(extensions)].join("|");
    }
    return null, prefix;
  }
};
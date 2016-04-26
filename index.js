
/**
 * Module dependencies.
 */

var uid2 = require('uid2');
var redis = require('redis').createClient;
var msgpack = require('msgpack-js');
var Adapter = require('socket.io-adapter');
var Emitter = require('events').EventEmitter;
var debug = require('debug')('socket.io-redis');

/**
 * Module exports.
 */

module.exports = adapter;

/**
 * Returns a redis Adapter class.
 *
 * @param {String} optional, redis uri
 * @return {RedisAdapter} adapter
 * @api public
 */

function adapter(uri, opts){
  opts = opts || {};

  // handle options only
  if ('object' == typeof uri) {
    opts = uri;
    uri = null;
  }

  // handle uri string
  if (uri) {
    uri = uri.split(':');
    opts.host = uri[0];
    opts.port = uri[1];
  }

  // opts
  var socket = opts.socket;
  var host = opts.host || '127.0.0.1';
  var port = Number(opts.port || 6379);
  var pub = opts.pubClient;
  var sub = opts.subClient;
  var prefix = opts.key || 'socket.io';
  var lastMsgString = null;
  var lastMsg = null;

  // init clients if needed
  if (!pub) pub = socket ? redis(socket) : redis(port, host);
  if (!sub) sub = socket
    ? redis(socket, { detect_buffers: true })
    : redis(port, host, {detect_buffers: true});


  // this server's key
  var uid = uid2(6);
  var key = prefix + '#' + uid;

  /**
   * Adapter constructor.
   *
   * @param {String} namespace name
   * @api public
   */

  function Redis(nsp){
    Adapter.call(this, nsp);

    var self = this;
    sub.psubscribe(prefix + '#*', function(err){
      if (err) self.emit('error', err);
    });
    sub.on('pmessage', this.onmessage.bind(this));
  }

  /**
   * Inherits from `Adapter`.
   */

  Redis.prototype.__proto__ = Adapter.prototype;

  /**
   * Called with a subscription message
   *
   * @api private
   */

  Redis.prototype.onmessage = function(pattern, channel, msg){
    var pieces = channel.split('#');
    if (uid == pieces.pop()) return debug('ignore same uid');
    var args, msgString;
    msgString = msg.toString();

    /* XXX MONKEY PATCH TO socket.io-redis! XXX

    socket.io-redis has serious architectural performance issue;
    Namely, it badly behaves when using many namespaces (200~),
    which are mapped to user groups in one-to-one way in our codebase.
    The problem is that it parses the exactly same msgpack blob
    as many as the number of namespaces.

    It should avoid such redundant parsing....

    Ref: https://github.com/socketio/socket.io-redis/blob/0.1.4/index.js#L94 */

    if (msgString === lastMsgString) {
      args = lastMsg;
    } else {
      lastMsgString = msgString;
      args = lastMsg = msgpack.decode(msg);
    }

    if (args[0] && args[0].nsp === undefined) {
      args[0].nsp = '/';
    }

    if (!args[0] || args[0].nsp != this.nsp.name) {
      return debug('ignore different namespace');
    }

    args.push(true);

    this.broadcast.apply(this, args);
  };

  /**
   * Broadcasts a packet.
   *
   * @param {Object} packet to emit
   * @param {Object} options
   * @param {Boolean} whether the packet came from another node
   * @api public
   */

  Redis.prototype.broadcast = function(packet, opts, remote){
    Adapter.prototype.broadcast.call(this, packet, opts);
    if (!remote) pub.publish(key, msgpack.encode([packet, opts]));
  };

  return Redis;

}

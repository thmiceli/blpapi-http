/// <reference path='../../typings/tsd.d.ts' />

import assert = require('assert');
import Promise = require('bluebird');
import _ = require('lodash');
import restify = require('restify');
import bunyan = require('bunyan');
import util = require('util');
import Interface = require('../interface');
import conf = require('../config');
import Subscription = require('../subscription/subscription');
import Session = require('../apisession/session');
import Map = require('../util/map');

// PRIVATE FUNCTIONS
function validatePollId(session: Session, newPollId: number): { isValid: boolean;
                                                                fetchNewData?: boolean; }
{
    if (newPollId === undefined) {
        return { isValid: false };
    }

    // Handle first request
    if (session.lastPollId === null) {
        session.lastPollId = newPollId;
        return { isValid: true,
                 fetchNewData: true};
    }

    if (session.lastPollId === session.lastSuccessPollId) {
        // Valid Poll Id. Poll old data
        if (session.lastPollId === newPollId) {
            session.lastPollId = newPollId;
            return { isValid: true,
                     fetchNewData: false};
        }
        // Valid Poll Id. Poll new data
        else if ((session.lastPollId + 1) === newPollId) {
            session.lastPollId = newPollId;
            return { isValid: true,
                     fetchNewData: true};
        }
        else {
            return { isValid: false };
        }
    }
    else {
        // Valid Poll Id. Poll new data
        if (session.lastPollId === newPollId) {
            session.lastPollId = newPollId;
            return { isValid: true,
                     fetchNewData: true};
        }
        else {
            return { isValid: false };
        }
    }
}

function startAllNewBuffers(subscriptionStore: Map<Subscription>): Object[]
{
    var buffers: Object[] = [];
    // Check if we have new data for any subscriptions
    var hasNewData: boolean = false;
    subscriptionStore.forEach((sub: Subscription): boolean => {
        hasNewData = !sub.buffer.isEmpty();
        return sub.buffer.isEmpty();
    });
    if (hasNewData) { // Start a new buffer for every subscription and return back the new data
        subscriptionStore.forEach((sub: Subscription): boolean => {
            var buff: Interface.IBufferedData<Object> = sub.buffer.startNewBuffer();
            if (buff.buffer.length) {
                buffers.push({
                    'correlationId': sub.correlationId,
                    'data': buff.buffer,
                    'missed_ticks': buff.overflow
                });
            }
            return true;
        });
    }
    return buffers;
}

function getAllOldBuffers(subscriptionStore: Map<Subscription>): Object[]
{
    var buffers: Object[] = [];
    subscriptionStore.forEach((sub: Subscription): boolean => {
        if (!sub.buffer.isEmpty(1)) {  // Check if old buffer is empty
            var buff: Interface.IBufferedData<Object> = sub.buffer.getBuffer(1);
            buffers.push({
                'correlationId': sub.correlationId,
                'data': buff.buffer,
                'missed_ticks': buff.overflow
            });
        }
        return true;
    });
    return buffers;
}

// PUBLIC FUNCTIONS
export function verifyContentType(req: Interface.IOurRequest,
                                  res: Interface.IOurResponse,
                                  next: restify.Next): void
{
    // Check the content type of the request
    // TODO: configure acceptable content-type
    if (!req.is('application/json')) {
        req.log.debug('Unsupported Content-Type.');
        return next(new restify.UnsupportedMediaTypeError('Unsupported Content-Type.'));
    }

    return next();
}

export function elevateRequest (req: Interface.IOurRequest,
                                res: Interface.IOurResponse,
                                next: restify.Next): void
{
    var chunkIndex: number = 0;

    /**
     * This is called each time data is added to the response.
     * @param isEnd Whether this is the last time this will be called for this http request.
     * @returns {string} Text that should be added to the response before the caller adds its data.
     */
    function prepareResponseText(isEnd: boolean): string {
        var text: string;
        if (1 === ++chunkIndex) {
            // This is the first time we're adding response text. Set the headers as well.
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            // If isEnd is true, then we aren't actually adding a data array to the http response.
            text = isEnd ? '{' : '{"data":[';
        } else {
            // If isEnd is true, we must have previously added data to the response, so we need to
            // close the data array.
            text = isEnd ? '],' : ',';
        }
        assert(text, 'Response text was not set');
        return text;
    }

    function stringifyPair ( key: string, value: any ): string {
        return '"' + key.replace(/'/g, '\\$&') + '":' + JSON.stringify(value);
    }

    // Right now we only use restify.InternalError(500)
    // TODO: Add error type differentiation
    function createError(err: Error): any {
        return new restify.InternalError(err.message);
    }

    res.sendChunk = (data: any): void => {
        var text = prepareResponseText(false);
        res.write(text + JSON.stringify(data));
    };

    res.sendEnd = (status: string, message: string): void => {
        var text = util.format('%s%s,%s}',
                               prepareResponseText(true),
                               stringifyPair('status', status),
                               stringifyPair('message', message || ''));
        res.end(text);
    };

    res.sendError = (err: Error): void|any => {
        // send Error if this is the first chunk
        if (chunkIndex === 0) {
            return createError(err);
        }
        // Otherwise, set -1 as status code and error message
        return res.sendEnd(-1, err.message);
    };

    return next();
}

export function onRequest(req: Interface.IOurRequest,
                          res: Interface.IOurResponse,
                          next: restify.Next): void
{
    assert(req.blpSession, 'blpSession not found');

    req.blpSession.request(util.format('//%s/%s', req.query.ns, req.query.service),
                           req.query.type,
                           req.body,
                           (err: Error, data: any, last: boolean): void => {
                               if (err) {
                                   req.log.error(err, 'Request error.');
                                   return next(res.sendError(err));
                               }
                               res.sendChunk(data);
                               if (last) {
                                   res.sendEnd(0, 'OK');
                                   return next();
                               }
                           });
}

export function onSubscribe(req: Interface.IOurRequest,
                            res: Interface.IOurResponse,
                            next: restify.Next): void
{
    var subscriptions: Subscription[] = [];
    ((): Promise<void> => {
        // Check if req body is valid
        if (!_.isArray(req.body) ||
            !req.body.length) {
            throw new Error('Invalid subscription request body.');
        }

        req.body.forEach((s: {'correlationId': number;
                              'security': string;
                              'fields': string[];
                              'options'?: any }): void => {
            // Check if all requests are valid
            // The Subscribe request will proceed only if all subscriptions are valid
            if (!_.has(s, 'correlationId') ||
                !_.isNumber(s.correlationId) ||
                !_.has(s, 'security') ||
                !_.isString(s.security) ||
                !_.has(s, 'fields') ||
                !_.isArray(s.fields)) {
                req.log.debug('Invalid subscription option.');
                throw new Error('Invalid subscription option.');
            }
            if (req.apiSession.receivedSubscriptions.has(s.correlationId)) {
                req.log.debug('Correlation Id ' + s.correlationId + ' already exist.');
                throw new Error('Correlation Id ' + s.correlationId + ' already exist.');
            }

            var sub = new Subscription(s.correlationId,
                                       s.security,
                                       s.fields,
                                       s.options,
                                       conf.get('longpoll.maxbuffersize'));
            subscriptions.push(sub);
            req.apiSession.receivedSubscriptions.set(sub.correlationId, sub);

            // Add event listener for each subscription
            sub.on('data', (data: any): void => {
                req.log.debug({data: {cid: sub.correlationId, time: process.hrtime()}},
                              'Data received');

                // Buffer the current data
                sub.buffer.pushValue(data);
            });

            // Must subscribe to the 'error' event; otherwise EventEmitter will throw an exception
            // that was occurring from the underlying blpapi.Session.  It is the assumed that the
            // blpapi.Session properly cleans up the subscription (i.e., 'unsubscribe()' should not
            // be called).
            sub.on('error', (err: Error): void => {
                req.log.error(err, 'blpapi.Session subscription error occurred.');
                sub.removeAllListeners();
                req.apiSession.activeSubscriptions.delete(sub.correlationId);
                req.apiSession.receivedSubscriptions.delete(sub.correlationId);
            });
        });

        // Subscribe user request through blpapi-wrapper
        return req.blpSession.subscribe(subscriptions);
    })()
        .then((): void => {
            if (!req.apiSession.expired) {
                subscriptions.forEach((s: Subscription): void => {
                    req.apiSession.activeSubscriptions.set(s.correlationId, s);
                });
                req.log.debug('Subscribed');
                res.sendEnd(0, 'Subscribed');
            } else { // Unsubscribe if session already expires
                req.blpSession.unsubscribe(subscriptions);
                subscriptions.forEach((s: Subscription): void => {
                    s.removeAllListeners();
                    req.apiSession.receivedSubscriptions.delete(s.correlationId);
                });
                req.log.debug('Unsubscribed all active subscriptions');
            }
            return next();
        })
        .catch((err: Error): any => {
            subscriptions.forEach((s: Subscription): void => {
                req.apiSession.receivedSubscriptions.delete(s.correlationId);
                s.removeAllListeners();
            });
            req.log.error(err, 'Request error.');
            return next(new restify.InternalError(err.message));
        });
}

export function onPollSubscriptions(req: Interface.IOurRequest,
                                    res: Interface.IOurResponse,
                                    next: restify.Next): void
{
    assert(req.apiSession, 'apiSession not found');

    if (!req.apiSession.activeSubscriptions.size) {
        req.log.debug('No active subscriptions.');
        return next(new restify.BadRequestError('No active subscriptions.'));
    }

    var interval: NodeJS.Timer;
    var frequency: number = conf.get('longpoll.pollfrequency');
    var timeOut: number = conf.get('longpoll.polltimeout');
    var pollId: number = _.parseInt(req.query.pollid);

    var validateIdResult = validatePollId(req.apiSession, pollId);
    if (!validateIdResult.isValid) {
        req.log.debug('Invalid Poll Id ' + req.query.pollid);
        return next(new restify.InvalidArgumentError('Invalid Poll Id '
                                                     + req.query.pollid));
    }

    var p: Promise<Object[]>;
    if (validateIdResult.fetchNewData) {
        // For fetching new data
        p = ((): Promise<Object[]> => {
                req.log.debug('Long polling...');
                var buff: Object[] = startAllNewBuffers(req.apiSession.activeSubscriptions);
                if (buff.length) {
                    req.apiSession.lastSuccessPollId = pollId;
                    req.log.debug('Got data. Sent back.');
                    return Promise.resolve(buff);
                }

                return (new Promise<Object[]>((resolve: (result: Object[]) => void,
                                               reject: (error: Error) => void): void => {
                    interval = setInterval(
                        (): void => {
                            if (!req.apiSession.activeSubscriptions.size) {
                                clearInterval(interval);
                                reject(new Error('No active subscriptions'));
                            }
                            var buffer = startAllNewBuffers(req.apiSession.activeSubscriptions);
                            if (buffer.length) {
                                clearInterval(interval);
                                req.apiSession.lastSuccessPollId = pollId;
                                req.log.debug('Got data. Sent back.');
                                resolve(buffer);
                            }
                        },
                        frequency);
                }))
                    .timeout(timeOut)
                    .cancellable();
            })();
    } else {
        // For fetching old data
        p = ((): Promise<Object[]> => {
                req.log.debug('Old poll id received. Resent last sent data.');
                return Promise.resolve(getAllOldBuffers(req.apiSession.activeSubscriptions));
            })();
    }

    p.then((result: Object[]): void => {
        res.sendChunk(result);
        res.sendEnd(0, 'OK');
        return next();
    })
        .catch(Promise.TimeoutError, (err: Error): any => {
            if (interval) {
                clearInterval(interval);
            }
            var message: string = 'No subscription data within ' + timeOut + 'ms.';
            req.log.debug(message);
            return next(new restify.RequestTimeoutError(message));
        })
        .catch(Promise.CancellationError, (err: Error): any => {
            req.log.debug('OnPoll promise get canceled');
            return next();
        })
        .catch((err: Error): any => {
            if (interval) {
                clearInterval(interval);
            }
            req.log.error(err, 'Poll error.');
            return next(new restify.InternalError(err.message));
        });

    // connection was terminated before response.end() was called
    res.once('close', (): void => {
        if (interval) {
            clearInterval(interval);
        }
        if (p.isCancellable()) {
            p.cancel();
        }
    });
}

export function onUnsubscribe(req: Interface.IOurRequest,
                              res: Interface.IOurResponse,
                              next: restify.Next): void
{
    if (!req.apiSession.activeSubscriptions.size) {
        req.log.debug('No active subscriptions.');
        return next(new restify.BadRequestError('No active subscriptions.'));
    }

    var subscriptions: Subscription[] = [];
    // If no correlation Id specified,
    // the default behavior is to unsubscribe all active subscriptions
    if (!req.body) {
        subscriptions = req.apiSession.activeSubscriptions.values();
    } else {
        // If we do receive req.body object, first check if it is valid(empty list is INVALID)
        if (!_.has(req.body, 'correlationIds') ||
            !_.isArray(req.body.correlationIds) ||
            !req.body.correlationIds.length) {
            req.log.debug('Invalid unsubscribe data.');
            return next(new restify.InvalidArgumentError('Invalid unsubscribe data.'));
        }
        // Next, validate all correlation Ids
        // Will error if any invalid correlation Id received
        var isAllValid = true;
        _.uniq(req.body.correlationIds).forEach((cid: number): boolean => {
            if (req.apiSession.activeSubscriptions.has(cid)) {
                subscriptions.push(req.apiSession.activeSubscriptions.get(cid));
            } else {
                isAllValid = false;
                req.log.debug('Invalid correlation Id ' + cid + ' received.');
                return false;
            }
        });
        if (!isAllValid) {
            return next(new restify.InvalidArgumentError('Invalid correlation id.'));
        }
    }

    try {
        var result: Object[] = [];
        req.blpSession.unsubscribe(subscriptions);
        subscriptions.forEach((sub: Subscription): void => {
            sub.removeAllListeners();
            if (!sub.buffer.isEmpty()) {
                result.push(sub.buffer.startNewBuffer());
            }
            req.apiSession.activeSubscriptions.delete(sub.correlationId);
            req.apiSession.receivedSubscriptions.delete(sub.correlationId);
        });
        req.log.debug({ activeSubscriptions:
                       req.apiSession.activeSubscriptions.size },
                      'Unsubscribed.');

        // Reset poll Id to null if all subscriptions get unsubscribed
        if (!req.apiSession.receivedSubscriptions.size) {
            req.apiSession.lastPollId = req.apiSession.lastSuccessPollId = null;
        }

        res.sendChunk(result);
        res.sendEnd(0, 'Unsubscribe Successfully');
        return next();
    } catch (err) {
        req.log.error(err, 'Unsubscription error');
        return next(new restify.InternalError(err.message));
    }
}

export function onChangeSubscriptions(req: Interface.IOurRequest,
                                      res: Interface.IOurResponse,
                                      next: restify.Next): void
{
    assert(req.apiSession, 'apiSession not found');
    assert(req.blpSession, 'blpSession not found');

    switch (req.query.action) {
        case 'start': {
            return onSubscribe(req, res, next);
        } break;
        case 'stop': {
            return onUnsubscribe(req, res, next);
        } break;
        default: {
            var errorString = 'Invalid subscription action: ' + req.query.action;
            req.log.error(errorString);
            return next(new restify.BadRequestError(errorString));
        } break;
    }
}

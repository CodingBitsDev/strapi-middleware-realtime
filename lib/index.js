let crypto = require('crypto');
let MutexPromise = require('mutex-promise')

module.exports = strapi => {
    //TODO Currently not secure since everyone can listen to all sockets
    //Check if user is authenticated and was allowed to make a get request before allowing the user to listen
    return {
      initialize() {
        console.log(strapi)

        let setUpRealTimeAPI = new Promise(function(resolve, reject) { 
            setTimeout(async () =>{
                //Set Up API EndPointListener
                setUpStrapiApiCheck(strapi);
                let io = require('socket.io')(strapi.server);
                let users = [];
                io.on('connection', (socket) => connectSocket(socket, users));
                io.on('reconnect', (socket) => {console.log("reconnect")});
            
                strapi.io = io; // register socket io inside strapi main object to use it globally anywhere
                strapi.emitToAllUsers = food => io.emit('food_ready', food);
                resolve();
            }, 5000)
        });

        strapi.app.use(async (ctx, next) => {
            await setUpRealTimeAPI;
            let endPointData = getEndPointData(strapi, ctx);
            if (endPointData){
                //TODO Listener not very efficient
                // let paths = endPointData.path.split("/");
                // console.log("###", paths, ctx.path, listeners);
                await next();
                if(listeners[endPointData.path]){
                    listeners[endPointData.path].forEach( socket => {
                        socket.emit('listen', {path:endPointData.path, val: ctx.request.body})
                    })
                }
            }
            else if (ctx.path != "/socket.io/"){
                await next();
            }
            else{
                console.log("###", ctx.path)
            }
        });
      },
    };
};

async function connectSocket(socket, users){
    socket.user_id = await getSecureToken();
    socket.listenPaths = [];
    users.push(socket); // save the socket to use it later
    socket.on('disconnect', () => {
        users.forEach((user, i) => {
            // delete saved user when they disconnect
            if(user.user_id === socket.user_id) users.splice(i, 1);
        });
        socket.listenPaths.forEach( path => {
            mutexListener.promise().then(() => {
                mutexListener.lock();
                if (listeners[path]){
                    listeners[path].filter( listenPath => {
                        return listenPath != path;
                    });
                }
            }).then( () => {
                mutexListener.unlock();
            }).catch(function(e){
                mutexListener.unlock();
                throw e;
            });
        });
    });
    socket.on('listen', (path) => {
        mutexListener.promise().then(() => {
            mutexListener.lock();
            if (listeners[path]){
                listeners[path].push(socket);
            }
            else{
                listeners[path] = [socket];
            }
        }).then( () => {
            mutexListener.unlock();
            socket.listenPaths.push(path);
        }).catch(function(e){
            mutexListener.unlock();
            throw e;
        });
        console.log("listen", path)
    });
}

let strapiAPIRoutes = [];
function setUpStrapiApiCheck(strapi){
    let stack = strapi.router.stack;
    let apis = strapi.api;
    let apiKeys = Object.keys(apis)
    for (let index = 0; index < apiKeys.length; index++) {
        let apiKey = apiKeys[index]
        let api = apis[apiKey]
        if (!api || !api.config || !api.config.routes) continue;
        let endPoints = api.config.routes;
        endPoints.forEach(endPoint => {
            let endPointInStack = stack.find( (stackPoint) => {
                return stackPoint.methods.includes(endPoint.method) && stackPoint.path === endPoint.path;
            })
            if (endPointInStack){
                strapiAPIRoutes.push(endPointInStack)
            }
        });
    }
}

let mutexListener = new MutexPromise('listener');
let listeners = {};
function getEndPointData(strapi, ctx){
    let isApiEndpoint = strapiAPIRoutes.find( (apiPoint) => {
        let isMethod = apiPoint.methods.includes(ctx.method);
        let isPath = apiPoint.regexp.test(ctx.path);
        return isMethod && isPath;
    });
    return isApiEndpoint;
}

async function getSecureToken(){
    return new Promise(function(resolve, reject) {
        crypto.randomBytes(48, function(crypto_err, buffer) { 
            let token = buffer.toString('hex'); 
            resolve(token)
        })
    });
} 
var util = require('./util/util');
var config = require("./configbuilder").getConfig();
var logger = require('./log');
var dbHandler = require('./dbset_handler');
var fs = require('fs');
var path = require('path');

function networkErrHandler(err) {
	var msg;
	switch (err.code) {
	    case 'EACCES':
	      msg = 'Permission denied for use of port ' + config.server.port;
	      break;
	    case 'EADDRINUSE':
	      msg = 'Port ' + config.server.port + ' is already in use.';
	      break;
	    case 'EADDRNOTAVAIL':
	      msg = 'Host "' + config.server.host + '" is not available.';
	      break;
	    default:
	      msg = err.message;
	}
	logger.error(msg);
	process.exit();
}

var reqResolver = require('./request_resolver');
var resHandler = require('./response_handler');
var color = require('./util/colors').color;
var url = require('url');

function requestResponseHandler(request, response) {
	var query = url.parse(request.url, true).query;
	var requestContext = {};
	if(query.debug){
		request.url = request.url.replace('debug=true','');
		if(request.url[request.url.length-1] == '?'){
			request.url = request.url.substr(0,request.url.length -1);
		}

		if(request.url == '/'){
			requestContext.scriptLocation = __dirname;
			requestContext.config = config;
			requestContext.projectPath = global.basePath;
			var os = require('os');
			requestContext.memory = {};
			requestContext.memory.total = os.totalmem();
			requestContext.memory.free = os.freemem();
			requestContext.hostname = os.hostname();
		}
	}

	  var startTime = new Date();
	  var body = [];
	  request.on('error', function(err) {
	  	logger.error(msg);
	  }).on('data', function(chunk) {
	    body.push(chunk);
	  }).on('end', function() {
	    body = Buffer.concat(body).toString();
		request['post'] = body;

		requestContext.request = {};
		requestContext.request.url = request.url;
		requestContext.request.headers = request.headers;
		requestContext.request.method = request.method;
		requestContext.request.body = request.post;

		logger.info(request.method+": "+request.url,'success');
		try{
			var matchedEntry = reqResolver.resolve(request);
			
			requestContext.matchedMapping = matchedEntry;

			if(matchedEntry == null){
				response.statusCode = 404;
				if(query.debug){
					response.end(JSON.stringify(requestContext));
				}else{
					response.end("");	
				}
				
				logger.error("Response served with Status Code " + response.statusCode);
				return;
			}
			

			logger.detailInfo("Matching Config: " + JSON.stringify(matchedEntry));
			
			resHandler.readResponse(matchedEntry,function(data,err){
				response = buildResponse(response,matchedEntry.response);
				requestContext.response = {};
				requestContext.response.raw = data;

				if(err == 404){
					response.statusCode = 404;
				}

				//1. replace DbSet Place Holders
				data = dbHandler.handle(data,matchedEntry.dbset);
				//2. replace request matches
				data = reqResolver.applyMatches(data,matchedEntry.request.matches);
				//3. replace markers
				data = require('./markers_handler').handle(data);
				//4. replace dumps
				data = require('./dumps_handler').handle(data);

				if(query.debug){
					requestContext.response.refined = data;
					response.end(JSON.stringify(requestContext));
				}else{
					response.write(data);
					response.end("");	
				}

				var responseTime = (new Date()) - startTime;
				if(response.statusCode == 200){
					logger.info("Response served in " + responseTime + " ms with Status Code " + response.statusCode,'success');
				}else{
					logger.info("Response served in " + responseTime + " ms with Status Code " + response.statusCode,'fail');
				}
			});
		}catch(e){
			logger.error(e);
			response.statusCode = 500;
			response.end("");
		}
	  });
}

function stubbyDB(){

	if(config.server.securePort){
		
		const options = {
		  key: fs.readFileSync(config.server.key),
		  cert: fs.readFileSync(config.server.cert)
		};
		if(config.server.ca){
			options.ca = [];
			config.server.ca.forEach(function(cert){
				options.ca.push(fs.readFileSync(cert));
			});
		}
		if(config.server.mutualSSL === true){
			options.requestCert= true;
  			options.rejectUnauthorized= true;
		}
		require('https').createServer(options, requestResponseHandler).listen(config.server.securePort,config.server.host, function(){
		    logger.info("Secure server listening on: https://" + config.server.host + ":" + config.server.securePort);

		});
	}

	if(config.server.port){
		this.server = require('http').createServer();
		this.server.on('error', networkErrHandler );
		this.server.on('request', requestResponseHandler);
		this.server.listen(config.server.port,config.server.host, function(){
		    logger.info("Server listening on: http://" + config.server.host + ":" + config.server.port);
		});
	}
}

function buildResponse(response,config){
	util.wait(config.latency);
	response.statusCode = config.status;
	if(config.headers){
		for(var header in config.headers){
			response.setHeader(header,config.headers[header]);
		}
		response.headers = config.headers;
	}

	return response;
}


module.exports = stubbyDB;
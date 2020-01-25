const lunr = require("lunr");
const fs = require("fs");
const AWS = require("aws-sdk");
const AWSHelper = require("aws-functions");
const s3 = new AWS.S3();

exports.lambdaHandler = async (event, context) => {

	if (event.headers['Authorization'] != process.env.INTERNAL_API_KEY) {
		return BuildResponse(403, "Unauthorized");
	}

	let path = event.path;
	try {
		switch (path) {
			case "/search":
				const userId = event.queryStringParameters.userId
				const query = event.queryStringParameters.q;
				const count = event.queryStringParameters.count || 25;
				return await SearchForDocument(process.env.INDEX_BUCKET_NAME, query, count, userId);
			case "/add":
				switch (event.httpMethod) {
					case "POST":
						let userId = event.queryStringParameters.userId
						let document = JSON.parse(event.body);
						return await UploadArticle(process.env.BUCKET_NAME, userId, document);
				}
			default:
				return BuildResponse(400, "Not a valid path, or you don't have access to it", false);
		}
	} catch (e) {
		console.log("ERROR", e);
		return BuildResponse(500, "An unexpected error occured, please check your input or search logs");
	}
};

async function UploadArticle(bucket, userId, document) {
	//add to S3 Bucket
	var params = {
		Bucket: bucket,
		Key: `articles/${userId}/` + Date.now() + ".json",
		Body: JSON.stringify(document)
	};

	try {
		await s3.putObject(params).promise();
		return BuildResponse(200, "Article Added");
	} catch (err) {
		console.log(err);
		return BuildResponse(400, "Upload Article Failed");
	}
}

async function SearchForDocument(bucket, query, numValues = 25, userId) {
	console.log(`Searching Index for ${userId} for '${query}' `);
	console.log("Got Request..");
	let SearchResults = [];

	//Load Multiple Indexes from S3
	try {
		//Fetch all available shards
		let listOfShards = await AWSHelper.listObjects(bucket, `indexes/${userId}/receipts/`);
		console.log("Received List of Shards...");
		let listOfDocumentPromises = [];
		for (var documentName of listOfShards) {
			listOfDocumentPromises.push(AWSHelper.getJSONFile(bucket, documentName));
		}

		try {
			let allIndexes = await Promise.all(listOfDocumentPromises);
			console.log("Got all Indexes...");
			for (var index of allIndexes) {
				if (index != null) {
					SearchResults = SearchResults.concat(GetSearchResults(index, query, numValues));
				} else {
					return BuildResponse(500, "Something went wrong while trying to query the index...");
				}
			}
			console.log("Got search results...");
		} catch (err) {
			console.log("Something went wrong while querying the index", err);
			return BuildResponse(500, "Something went wrong while trying to query the index...");
		}

		SearchResults.sort(function(hitA, hitB) {
			return hitB.score - hitA.score;
		});

		console.log("Sending sorted results", SearchResults);

		const results = SearchResults.slice(0, numValues)

		return BuildResponse(200, results.map(r => r.ref), true);
	} catch (err) {
		console.log("No Search Index was found");
		console.log(err.message);
		return BuildResponse(412, "No Search Index was found, or it was invalid. Make sure you have uploaded a index config first.");
	}
}

function GetSearchResults(searchIndex, query, numValues) {
	//load the index to lunr
	let index = lunr.Index.load(searchIndex);
	//perform
	let results = index.query(function() {
		// exact matches should have the highest boost
		this.term(lunr.tokenizer(query), { boost: 100 });

		// prefix matches should be boosted slightly
		this.term(query, { boost: 10, usePipeline: false, wildcard: lunr.Query.wildcard.TRAILING });

		// finally, try a fuzzy search with character 2, without any boost
		this.term(query, { boost: 5, usePipeline: false, editDistance: 2 });
	});
	return results.slice(0, numValues);
}

function BuildResponse(statusCode, responseBody, shouldStringify = false) {
	let body = "invalid response";
	if (shouldStringify) {
		body = JSON.stringify(responseBody);
	} else {
		body = JSON.stringify({ msg: responseBody });
	}

	let response = {
		statusCode,
		body
	};

	return response;
}

function isValidIndexName(str) {
	if (str) {
		var re = /^[a-z-]+$/g;
		return re.test(str);
	}

	return false;
}

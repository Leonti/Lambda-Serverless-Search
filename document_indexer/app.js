const lunr = require("lunr");
const AWS = require("aws-sdk");
const AWSHelper = require("aws-functions");
const s3 = new AWS.S3();
let BUCKET_NAME, IndexConfig;

exports.lambdaHandler = async (event, context) => {
	BUCKET_NAME = process.env.BUCKET_NAME;
	INDEX_BUCKET_NAME = process.env.INDEX_BUCKET_NAME;

	let AddedItem = event.Records[0].s3.object.key;

	//no need to index anything that hasn't been added to articles
	if (!AddedItem.startsWith("articles/")) {
		return "Skipping the addition of a non-article";
	}

	const userId = AddedItem.split('/')[1]

	const config = {
		"name": "receipts",
		"fields":["text"],
		"ref": "id",
		"shards": 1000
	}

	const listOfDocuments = await AWSHelper.listObjects(BUCKET_NAME, `articles/${userId}`);
	console.log(`Got list of articles for user '${userId}'`);
	const listOfDocumentPromises = listOfDocuments.map(documentName => AWSHelper.getJSONFile(BUCKET_NAME, documentName));

	const allUserArticles = await Promise.all(listOfDocumentPromises);

	let IndexUploadPromiseArray = [];
	//make indexes and upload them
	let ShardSize = config.shards || 1000;
	let shardedArray = ShardArray(allUserArticles, ShardSize);

	let indexCount = 1;
	for (var articles of shardedArray) {
		//build the index up for each shard and upload new index
		var index = lunr(function() {
			for (var field of config.fields) {
				this.field(field);
			}

			this.ref(config.ref);
			articles.forEach(function(article) {
				this.add(article);
			}, this);
		});

		//upload JSON Indexes in Parallel
		IndexUploadPromiseArray.push(
			AWSHelper.uploadToS3(INDEX_BUCKET_NAME, `indexes/${userId}/` + config.name + "/search_index_" + indexCount + ".json", JSON.stringify(index))
		);
		console.log("Uploaded index: " + config.name + "_" + indexCount);
		indexCount++
	}

	try {
		await Promise.all(IndexUploadPromiseArray);
	} catch (e) {
		console.log("Something went wrong: ", e);
	}
};

function ShardArray(allitems, chunk_size) {
	var arrays = [];

	let StartIndex = 0;
	while (StartIndex <= allitems.length) {
		arrays.push(allitems.slice(StartIndex, StartIndex + chunk_size));
		StartIndex += chunk_size;
	}

	return arrays;
}

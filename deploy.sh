#! /bin/bash

sam package \
    --output-template-file packaged.yaml \
    --s3-bucket receipts-search-artefacts

sam deploy \
    --template-file packaged.yaml \
    --stack-name receipts-search \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides $(cat parameters.properties)   


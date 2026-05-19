#!/bin/sh
container build --secret id=GITHUB_TOKEN,src=./github_token.txt --dns 9.9.9.9 --tag dev:1 .

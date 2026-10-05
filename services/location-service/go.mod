module github.com/Vimal-Sabari/ride-dispatch-platform/services/location-service

go 1.24

require (
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go v0.0.0
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial v0.0.0
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/logging/go v0.0.0
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go v0.0.0
	github.com/aws/aws-lambda-go v1.47.0
	github.com/aws/aws-sdk-go-v2 v1.47.0
	github.com/aws/aws-sdk-go-v2/service/dynamodb v1.69.0
)

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go => ../../shared/dynamo-client/go

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial => ../../shared/geospatial

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/logging/go => ../../shared/logging/go

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go => ../../shared/models/go

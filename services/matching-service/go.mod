module github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service

go 1.24

require (
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial v0.0.0
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/logging/go v0.0.0
	github.com/Vimal-Sabari/ride-dispatch-platform/shared/matching-algorithms v0.0.0
	github.com/aws/aws-sdk-go-v2/service/dynamodb v1.69.0
)

require github.com/aws/smithy-go v1.28.1 // indirect

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go => ../../shared/dynamo-client/go

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial => ../../shared/geospatial

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/logging/go => ../../shared/logging/go

replace github.com/Vimal-Sabari/ride-dispatch-platform/shared/matching-algorithms => ../../shared/matching-algorithms

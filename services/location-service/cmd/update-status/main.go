package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/location-service/internal/handler"
	dynamoclient "github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go"
	models "github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go"
)

func newStatusHandler(writer handler.DynamoWriter) func(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return func(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
		driverID := ""
		if event.PathParameters != nil {
			driverID = event.PathParameters["id"]
		}
		if driverID == "" {
			bodyBytes, _ := json.Marshal(map[string]string{"error": "missing driver id in path parameters"})
			return events.APIGatewayProxyResponse{
				StatusCode: 400,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       string(bodyBytes),
			}, nil
		}

		var req models.StatusUpdateRequest
		if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
			bodyBytes, _ := json.Marshal(map[string]string{"error": "invalid json request body"})
			return events.APIGatewayProxyResponse{
				StatusCode: 400,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       string(bodyBytes),
			}, nil
		}

		code, respBody, _ := handler.HandleUpdateStatus(ctx, driverID, req, writer)
		respBytes, _ := json.Marshal(respBody)

		return events.APIGatewayProxyResponse{
			StatusCode: code,
			Headers:    map[string]string{"Content-Type": "application/json"},
			Body:       string(respBytes),
		}, nil
	}
}

func getClientFromEnv(ctx context.Context) (*dynamoclient.Client, error) {
	tableName := os.Getenv("DYNAMO_TABLE_NAME")
	if tableName == "" {
		tableName = "ride-dispatch-table"
	}
	endpoint := os.Getenv("DYNAMO_ENDPOINT")

	return dynamoclient.NewClient(ctx, tableName, endpoint)
}

func main() {
	ctx := context.Background()
	client, err := getClientFromEnv(ctx)
	if err != nil {
		log.Fatalf("failed to initialize DynamoDB client: %v", err)
	}

	lambda.Start(newStatusHandler(client))
}

package classify

import (
	"strconv"

	"github.com/aws/aws-lambda-go/events"
)

// ConvertAttributeValueMap converts a DynamoDB AttributeValue map from events.DynamoDBEventRecord
// into a standard map[string]interface{}.
func ConvertAttributeValueMap(avMap map[string]events.DynamoDBAttributeValue) map[string]interface{} {
	if avMap == nil {
		return nil
	}
	result := make(map[string]interface{}, len(avMap))
	for k, v := range avMap {
		result[k] = convertAttributeValue(v)
	}
	return result
}

// ConvertRecord converts a raw events.DynamoDBEventRecord into a StreamRecord.
func ConvertRecord(record events.DynamoDBEventRecord) StreamRecord {
	sr := StreamRecord{
		EventName: record.EventName,
		NewImage:  ConvertAttributeValueMap(record.Change.NewImage),
		OldImage:  ConvertAttributeValueMap(record.Change.OldImage),
	}

	if pk, ok := record.Change.Keys["PK"]; ok {
		sr.PK = pk.String()
	} else if sr.NewImage != nil {
		if pkVal, ok := sr.NewImage["PK"].(string); ok {
			sr.PK = pkVal
		}
	}

	if sk, ok := record.Change.Keys["SK"]; ok {
		sr.SK = sk.String()
	} else if sr.NewImage != nil {
		if skVal, ok := sr.NewImage["SK"].(string); ok {
			sr.SK = skVal
		}
	}

	return sr
}

func convertAttributeValue(av events.DynamoDBAttributeValue) interface{} {
	switch av.DataType() {
	case events.DataTypeString:
		return av.String()
	case events.DataTypeNumber:
		nStr := av.Number()
		if f, err := strconv.ParseFloat(nStr, 64); err == nil {
			return f
		}
		return nStr
	case events.DataTypeBoolean:
		return av.Boolean()
	case events.DataTypeNull:
		return nil
	case events.DataTypeMap:
		m := av.Map()
		res := make(map[string]interface{}, len(m))
		for k, v := range m {
			res[k] = convertAttributeValue(v)
		}
		return res
	case events.DataTypeList:
		l := av.List()
		res := make([]interface{}, len(l))
		for i, v := range l {
			res[i] = convertAttributeValue(v)
		}
		return res
	case events.DataTypeStringSet:
		return av.StringSet()
	case events.DataTypeNumberSet:
		return av.NumberSet()
	case events.DataTypeBinary:
		return av.Binary()
	case events.DataTypeBinarySet:
		return av.BinarySet()
	default:
		return av.String()
	}
}

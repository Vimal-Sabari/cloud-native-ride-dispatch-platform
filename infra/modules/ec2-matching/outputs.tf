output "instance_id" {
  description = "The EC2 instance ID for Matching Service (empty in local environment)"
  value       = try(aws_instance.matching_service[0].id, "")
}

output "public_ip" {
  description = "Public IP address of the Matching Service EC2 instance (used for scp/ssh deployment in real AWS)"
  value       = try(aws_instance.matching_service[0].public_ip, "")
}

output "private_ip" {
  description = "Private IP address of the Matching Service EC2 instance"
  value       = try(aws_instance.matching_service[0].private_ip, "")
}

output "iam_role_arn" {
  description = "IAM Role ARN for Matching Service"
  value       = try(aws_iam_role.matching_service[0].arn, "")
}

import { Request, Response } from 'express';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';
import { sendContactNotificationEmail, sendContactConfirmationEmail } from '../services/email.service';

// ============================================
// CONTACT CONTROLLER
// Handles contact form submissions and enterprise inquiries
// ============================================

/**
 * Submit a contact form request
 * POST /api/contact
 */
export const submitContactForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      name, 
      email, 
      company, 
      phone, 
      subject, 
      message, 
      requestType = 'general',
      planInterest 
    } = req.body;

    // Validation
    if (!name || !email || !message) {
      res.status(400).json({
        success: false,
        message: 'Name, email, and message are required',
      });
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
      return;
    }

    // Get user ID if authenticated
    const userId = req.userId || null;

    // Get IP and user agent
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    // Insert contact request
    const [result] = await sequelize.query<any>(
      `INSERT INTO contact_requests 
        (name, email, company, phone, subject, message, request_type, plan_interest, user_id, ip_address, user_agent)
        VALUES (:name, :email, :company, :phone, :subject, :message, :requestType, :planInterest, :userId, :ipAddress, :userAgent)
        RETURNING id, created_at`,
      {
        replacements: {
          name,
          email,
          company: company || null,
          phone: phone || null,
          subject: subject || (requestType === 'enterprise' ? 'Enterprise Plan Inquiry' : 'General Inquiry'),
          message,
          requestType,
          planInterest: planInterest || null,
          userId,
          ipAddress,
          userAgent,
        },
        type: QueryTypes.SELECT,
      }
    );

    const contactId = result?.id;

    // Send notification email to admin
    try {
      await sendContactNotificationEmail({
        name,
        email,
        company,
        subject: subject || (requestType === 'enterprise' ? 'Enterprise Plan Inquiry' : 'General Inquiry'),
        message,
        requestType,
        planInterest,
        contactId,
      });
    } catch (emailError) {
      logger.error('[CONTACT_CONTROLLER] Failed to send admin notification:', emailError);
    }

    // Send confirmation email to user
    try {
      await sendContactConfirmationEmail(email, name);
    } catch (emailError) {
      logger.error('[CONTACT_CONTROLLER] Failed to send user confirmation:', emailError);
    }

    logger.info(`[CONTACT_CONTROLLER] Contact form submitted: ${email} (${requestType})`);

    res.status(201).json({
      success: true,
      message: requestType === 'enterprise' 
        ? 'Thank you for your interest in our Enterprise plan! Our team will contact you within 24-48 hours.'
        : 'Thank you for contacting us! We will get back to you as soon as possible.',
      data: {
        id: contactId,
      },
    });
  } catch (error: any) {
    logger.error('[CONTACT_CONTROLLER] Contact form submission failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit contact form. Please try again later.',
      error: error.message,
    });
  }
};

/**
 * Submit an enterprise inquiry (shortcut endpoint)
 * POST /api/contact/enterprise
 */
export const submitEnterpriseInquiry = async (req: Request, res: Response): Promise<void> => {
  // Add enterprise-specific defaults
  req.body.requestType = 'enterprise';
  req.body.planInterest = 'enterprise';
  
  return submitContactForm(req, res);
};

/**
 * Get contact requests (admin only)
 * GET /api/contact/list
 */
export const getContactRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Add admin role check
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const status = req.query.status as string;
    const requestType = req.query.requestType as string;
    const offset = (page - 1) * pageSize;

    let whereClause = '1=1';
    const replacements: any = { pageSize, offset };

    if (status) {
      whereClause += ' AND status = :status';
      replacements.status = status;
    }

    if (requestType) {
      whereClause += ' AND request_type = :requestType';
      replacements.requestType = requestType;
    }

    const [countResult] = await sequelize.query<any>(
      `SELECT COUNT(*) as count FROM contact_requests WHERE ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const requests = await sequelize.query<any>(
      `SELECT 
        id,
        name,
        email,
        company,
        phone,
        subject,
        message,
        request_type,
        plan_interest,
        status,
        assigned_to,
        response_notes,
        responded_at,
        created_at,
        updated_at
       FROM contact_requests
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT :pageSize OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    const totalCount = parseInt(countResult.count);

    res.json({
      success: true,
      data: requests,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error: any) {
    logger.error('[CONTACT_CONTROLLER] Failed to get contact requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get contact requests',
      error: error.message,
    });
  }
};

/**
 * Update contact request status (admin only)
 * PATCH /api/contact/:id
 */
export const updateContactRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Add admin role check
    const { id } = req.params;
    const { status, assignedTo, responseNotes } = req.body;

    const updates: string[] = [];
    const replacements: any = { id };

    if (status) {
      updates.push('status = :status');
      replacements.status = status;
      if (status === 'responded') {
        updates.push('responded_at = CURRENT_TIMESTAMP');
      }
    }

    if (assignedTo !== undefined) {
      updates.push('assigned_to = :assignedTo');
      replacements.assignedTo = assignedTo;
    }

    if (responseNotes !== undefined) {
      updates.push('response_notes = :responseNotes');
      replacements.responseNotes = responseNotes;
    }

    if (updates.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No updates provided',
      });
      return;
    }

    await sequelize.query(
      `UPDATE contact_requests 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { replacements, type: QueryTypes.UPDATE }
    );

    res.json({
      success: true,
      message: 'Contact request updated successfully',
    });
  } catch (error: any) {
    logger.error('[CONTACT_CONTROLLER] Failed to update contact request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update contact request',
      error: error.message,
    });
  }
};

export default {
  submitContactForm,
  submitEnterpriseInquiry,
  getContactRequests,
  updateContactRequest,
};

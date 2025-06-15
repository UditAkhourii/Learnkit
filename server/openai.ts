import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Assistant ID for visualization specialist
const VISUALIZATION_ASSISTANT_ID = "asst_924mwo6duhGAjPTpIKP3gUdW";

// Model for GPT-4o mini with search preview capability
const SEARCH_PREVIEW_MODEL = "gpt-4o-mini-search-preview-2025-03-11";

/**
 * Generate text response using GPT-4o
 */
export async function generateTextResponse(prompt: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0].message.content || "No response generated";
  } catch (error) {
    console.error("Error generating text response:", error);
    throw new Error(`Failed to generate text response: ${(error as Error).message}`);
  }
}

/**
 * Process a follow-up question on a specific element
 */
export async function processFollowUpQuestion(
  elementType: string, 
  elementContent: any, 
  question: string,
  originalQuestion?: string,
  previousResponses?: any[]
): Promise<any> {
  try {
    // Build conversation context from original question and previous responses if available
    let conversationContext = "";
    if (originalQuestion) {
      conversationContext += `Original question that started this learning journey: "${originalQuestion}"\n\n`;
    }
    
    if (previousResponses && previousResponses.length > 0) {
      conversationContext += "Previous conversation context:\n";
      previousResponses.forEach((response, index) => {
        conversationContext += `Follow-up question ${index + 1}: ${response.question}\n`;
        conversationContext += `Response ${index + 1}: ${JSON.stringify(response.answer)}\n\n`;
      });
    }
    
    switch (elementType) {
      case 'text':
        return await processTextFollowUp(elementContent, question, conversationContext);
      case 'image':
        return await processImageFollowUp(elementContent, question, conversationContext);
      case 'diagram':
        return await processDiagramFollowUp(elementContent, question, conversationContext);
      case 'equation':
        return await processEquationFollowUp(elementContent, question, conversationContext);
      case 'code':
        return await processCodeFollowUp(elementContent, question, conversationContext);
      case 'connected':
        return await processConnectedElementsQuestion(elementContent, question, conversationContext);
      default:
        throw new Error(`Unsupported element type: ${elementType}`);
    }
  } catch (error) {
    console.error("Error processing follow-up question:", error);
    throw new Error(`Failed to process follow-up question: ${(error as Error).message}`);
  }
}

/**
 * Process a question about two connected elements
 */
async function processConnectedElementsQuestion(
  connectedContent: { 
    sourceElement: { type: string; content: any; id: string; },
    targetElement: { type: string; content: any; id: string; }
  }, 
  question: string, 
  conversationContext: string = ""
): Promise<any> {
  // Extract information about both elements
  const { sourceElement, targetElement } = connectedContent;
  
  // Format context for source element
  let sourceContext = `First Element (${sourceElement.type.toUpperCase()}):\n`;
  
  if (sourceElement.type === 'text') {
    // Handle text element
    const content = sourceElement.content;
    sourceContext += content.title ? `Title: ${content.title}\n` : '';
    sourceContext += content.explanation ? `Content: ${content.explanation}\n` : '';
    if (content.keyPoints && content.keyPoints.length > 0) {
      sourceContext += `Key Points: ${content.keyPoints.join(', ')}\n`;
    }
  } else if (sourceElement.type === 'image') {
    // Handle image element
    const content = sourceElement.content;
    sourceContext += content.title ? `Image Title: ${content.title}\n` : '';
    sourceContext += content.description ? `Image Description: ${content.description}\n` : '';
  } else if (sourceElement.type === 'diagram') {
    // Handle diagram/mind map element
    const content = sourceElement.content;
    sourceContext += content.central_topic ? `Main Topic: ${content.central_topic}\n` : '';
    if (content.main_branches && content.main_branches.length > 0) {
      sourceContext += `Branches: ${content.main_branches.map((b: any) => b.topic).join(', ')}\n`;
    }
  } else if (sourceElement.type === 'equation') {
    // Handle equation element
    const content = sourceElement.content;
    sourceContext += content.equation ? `Equation: ${content.equation}\n` : '';
    sourceContext += content.explanation ? `Explanation: ${content.explanation}\n` : '';
  } else if (sourceElement.type === 'code') {
    // Handle code element
    const content = sourceElement.content;
    sourceContext += content.title ? `Code Title: ${content.title}\n` : '';
    sourceContext += content.code ? `Code: ${content.code.substring(0, 200)}...\n` : '';
    sourceContext += content.explanation ? `Code Explanation: ${content.explanation}\n` : '';
  }
  
  // Format context for target element
  let targetContext = `\nSecond Element (${targetElement.type.toUpperCase()}):\n`;
  
  if (targetElement.type === 'text') {
    // Handle text element
    const content = targetElement.content;
    targetContext += content.title ? `Title: ${content.title}\n` : '';
    targetContext += content.explanation ? `Content: ${content.explanation}\n` : '';
    if (content.keyPoints && content.keyPoints.length > 0) {
      targetContext += `Key Points: ${content.keyPoints.join(', ')}\n`;
    }
  } else if (targetElement.type === 'image') {
    // Handle image element
    const content = targetElement.content;
    targetContext += content.title ? `Image Title: ${content.title}\n` : '';
    targetContext += content.description ? `Image Description: ${content.description}\n` : '';
  } else if (targetElement.type === 'diagram') {
    // Handle diagram/mind map element
    const content = targetElement.content;
    targetContext += content.central_topic ? `Main Topic: ${content.central_topic}\n` : '';
    if (content.main_branches && content.main_branches.length > 0) {
      targetContext += `Branches: ${content.main_branches.map((b: any) => b.topic).join(', ')}\n`;
    }
  } else if (targetElement.type === 'equation') {
    // Handle equation element
    const content = targetElement.content;
    targetContext += content.equation ? `Equation: ${content.equation}\n` : '';
    targetContext += content.explanation ? `Explanation: ${content.explanation}\n` : '';
  } else if (targetElement.type === 'code') {
    // Handle code element
    const content = targetElement.content;
    targetContext += content.title ? `Code Title: ${content.title}\n` : '';
    targetContext += content.code ? `Code: ${content.code.substring(0, 200)}...\n` : '';
    targetContext += content.explanation ? `Code Explanation: ${content.explanation}\n` : '';
  }
  
  // Combine contexts
  const combinedContext = sourceContext + targetContext;
  
  // Generate a response that analyzes the connection between the two elements
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant analyzing the relationship between two connected elements.
          Based on the information from both elements, provide insights about their relationship, connections, similarities, differences, or how they complement each other.
          Generate a JSON response with:
          "answer": A comprehensive analysis that explains the relationship between the two elements and answers the user's specific question
          "insights": [Array of 3-5 key insights or observations about how these elements relate to each other]
          "synthesis": A brief statement that captures the most important takeaway from connecting these two elements`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}
        Connected Elements Information:
        ${combinedContext}
        
        Question about the connected elements: "${question}"`
      }
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Process a follow-up question on a text element
 */
async function processTextFollowUp(textContent: any, question: string, conversationContext: string = ""): Promise<any> {
  // Format the context from the text element, handling both old and new format
  let context = '';
  
  // Handle main explanation (could be in explanation or main_explanation field depending on format)
  if (textContent.main_explanation) {
    context += `Original explanation: ${textContent.main_explanation}\n`;
  } else if (textContent.explanation) {
    context += `Original explanation: ${textContent.explanation}\n`;
  }
  
  // Handle key facts/points (could be in keyPoints or key_facts field)
  if (textContent.key_facts && textContent.key_facts.length > 0) {
    context += `Key facts:\n${textContent.key_facts.map((p: string) => `- ${p}`).join('\n')}\n`;
  } else if (textContent.keyPoints && textContent.keyPoints.length > 0) {
    context += `Key points:\n${textContent.keyPoints.map((p: string) => `- ${p}`).join('\n')}\n`;
  }
  
  // Handle related concepts
  if (textContent.related_concepts && textContent.related_concepts.length > 0) {
    context += `Related concepts: ${textContent.related_concepts.join(', ')}\n`;
  } else if (textContent.relatedConcepts && textContent.relatedConcepts.length > 0) {
    context += `Related concepts: ${textContent.relatedConcepts.join(', ')}\n`;
  }
  
  // Handle books and resources if available in new format
  if (textContent.books_and_resources && textContent.books_and_resources.length > 0) {
    context += `Books and resources:\n`;
    textContent.books_and_resources.forEach((resource: any) => {
      context += `- ${resource.title} by ${resource.author}: ${resource.description}\n`;
    });
  }
  
  // Handle study syllabus if available
  if (textContent.study_syllabus && textContent.study_syllabus.length > 0) {
    context += `Study syllabus: ${textContent.study_syllabus.join(' → ')}\n`;
  }
  
  // Include pre-existing follow-up Q&A if available
  if (textContent.follow_up_questions && textContent.follow_up_questions.length > 0) {
    context += `Previously answered questions:\n`;
    textContent.follow_up_questions.forEach((qa: any) => {
      context += `Q: ${qa.question}\nA: ${qa.answer}\n\n`;
    });
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant answering a follow-up question about a previously explained topic.
          Keep your answer concise but comprehensive. Generate a JSON response with:
          "answer": A direct answer to the follow-up question based on the provided context
          "additional_points": [Array of 2-4 additional relevant facts or insights beyond what was in the original explanation]
          "resources": [Array of 1-2 specific resources (books, articles, websites) that would help deepen understanding of this specific question]`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}Context:\n${context}\n\nFollow-up question: ${question}`
      }
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Process a follow-up question on an image element
 */
async function processImageFollowUp(imageContent: any, question: string, conversationContext: string = ""): Promise<any> {
  // For image follow-ups, we need to analyze the image and the question
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant answering a follow-up question about an image. 
          This is a visualization related to: "${imageContent.title || 'educational visualization'}".
          Generate a JSON response with:
          "answer": A detailed explanation addressing the specific question about the image
          "related_concept": A brief explanation of one related concept that extends the learning`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}Follow-up question about the image: "${question}"`
      }
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Process a follow-up question on a diagram/mind map element
 */
async function processDiagramFollowUp(diagramContent: any, question: string, conversationContext: string = ""): Promise<any> {
  // Extract the mind map structure to provide as context
  let context = '';
  
  if (diagramContent.centralTopic && diagramContent.branches) {
    context = `Mind map central topic: ${diagramContent.centralTopic}\n`;
    context += "Branches:\n";
    
    diagramContent.branches.forEach((branch: any) => {
      context += `- ${branch.topic}:\n`;
      branch.subTopics.forEach((subTopic: string) => {
        context += `  * ${subTopic}\n`;
      });
    });
  } else if (diagramContent.title) {
    context = `Diagram title: ${diagramContent.title}\n`;
    if (diagramContent.description) {
      context += `Description: ${diagramContent.description}\n`;
    }
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant answering a follow-up question about a diagram or mind map.
          Keep your answer focused and educational. Generate a JSON response with:
          "answer": A comprehensive answer to the question based on the diagram
          "summary": A concise 1-2 sentence summary if they asked for one
          "connections": [Array of connections or relationships between concepts in the diagram that are relevant to the question]`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}Diagram context:\n${context}\n\nFollow-up question: ${question}`
      }
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Process a follow-up question on an equation element
 */
async function processEquationFollowUp(equationContent: any, question: string, conversationContext: string = ""): Promise<any> {
  const context = `Equation: ${equationContent.equation}\n`;
  const explanation = equationContent.explanation ? `Explanation: ${equationContent.explanation}\n` : '';
  const application = equationContent.application ? `Application: ${equationContent.application}\n` : '';

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant specialized in mathematics and science, answering follow-up questions about equations.
          Be precise and educational. Generate a JSON response with:
          "answer": A detailed answer to the question about the equation
          "example_calculation": A step-by-step example calculation using the equation if applicable
          "advanced_insight": One advanced insight about this equation or formula that extends beyond basic understanding`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}Equation context:\n${context}${explanation}${application}\n\nFollow-up question: ${question}`
      }
    ],
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Process a follow-up question on a code visualization element
 */
async function processCodeFollowUp(codeContent: any, question: string, conversationContext: string = ""): Promise<any> {
  // Format the context from the code/chart element
  let context = `Chart type: ${codeContent.chart_type}\n`;
  
  if (codeContent.title) {
    context += `Title: ${codeContent.title}\n`;
  }
  
  if (codeContent.description) {
    context += `Description: ${codeContent.description}\n`;
  }
  
  // Provide a summary of the data if available
  if (codeContent.data && Array.isArray(codeContent.data) && codeContent.data.length > 0) {
    context += `Data summary: The data contains ${codeContent.data.length} points`;
    
    // Get the first data point to see its structure
    const sample = codeContent.data[0];
    if (sample) {
      context += ` with properties: ${Object.keys(sample).join(', ')}\n`;
      
      // For smaller datasets, include a sample of values
      if (codeContent.data.length <= 10) {
        context += 'Sample values:\n';
        codeContent.data.forEach((item: any, index: number) => {
          context += `${index + 1}. ${JSON.stringify(item)}\n`;
        });
      } else {
        // For larger datasets, just include the first and last items
        context += 'Sample values (first item):\n';
        context += JSON.stringify(codeContent.data[0]) + '\n';
        context += 'Sample values (last item):\n';
        context += JSON.stringify(codeContent.data[codeContent.data.length - 1]) + '\n';
      }
    }
  }
  
  // Include the original code if available
  if (codeContent.code) {
    context += `\nOriginal code:\n${codeContent.code}\n`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant specialized in data visualization and analysis.
          You are analyzing a ${codeContent.chart_type} chart and answering questions about it.
          Generate a JSON response with:
          "answer": A detailed explanation addressing the specific question about the data visualization
          "insights": [Array of 2-4 data insights that can be drawn from the visualization]
          "modified_code": If the user asks for changes to the visualization, provide updated code, otherwise omit this field`
      },
      { 
        role: "user", 
        content: `${conversationContext ? conversationContext + "\n\n" : ""}Visualization context:\n${context}\n\nFollow-up question: ${question}`
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 2500,
  });

  return JSON.parse(response.choices[0].message.content || "{}");
}

/**
 * Generate structured responses for the AI whiteboard
 */
export async function generateStructuredResponse(prompt: string): Promise<any> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an educational AI assistant that generates comprehensive structured content for a visualization-centric learning experience.
            Generate responses in JSON format that includes:
            1. "image_contexts": An array of 3-4 specific visual angles or perspectives of the topic that would be educational to see visualized. Each should focus on a different aspect of the topic.
            2. "image_exploration_prompts": An array of 3-4 questions matching each image context that guide students to analyze and interpret the visualizations.
            3. "key_facts": An array of 5-8 factual, verified statements about the topic that are essential knowledge and complement the visualizations.
            4. "concise_explanation": A concise but thorough explanation (200-300 words) that ties together the concepts shown in the visuals.
            5. "books_and_resources": An array of objects containing {title, author, url, description} for 3-5 high-quality learning resources.
            6. "visual_learning_activities": An array of 2-3 activities students can do to interact with the images and deepen their understanding.
            7. "related_concepts": An array of 3-5 connected concepts that extend understanding of this topic.
            8. "follow_up_questions": An array of 3-5 objects with structure {question: "Question text?", answer: "Detailed answer to the question"} covering the most valuable follow-up questions a student might ask.
            
            Make content educational, academically rigorous, and designed to complement multiple visualizations. All content should be factually accurate and represent current knowledge.
            This will be displayed on a learning canvas in a visualization-first layout:
            - Multiple images are at the center of the learning experience
            - Supporting text and explanations are arranged around the visualizations
            - The learning journey begins with visual exploration and is supplemented by text
            - Follow-up questions are connected to the main explanation
            - Facts and insights are connected to the visualization
            - The mind map shows the syllabus, learning pathways, resources, and books
            
            Your structure needs to perfectly match this hierarchical arrangement with appropriate content in each section.`
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000, // Increase max tokens to ensure complete responses
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Error generating structured response:", error);
    throw new Error(`Failed to generate structured response: ${(error as Error).message}`);
  }
}

/**
 * Generate learning resources with live links using GPT-4o mini's Search Preview
 */
import { isUrlAlive, getFallbackUrls } from './utils';

export async function generateLearningResourcesWithLinks(topic: string): Promise<any> {
  try {
    console.log(`Generating learning resources with links for: ${topic}`);
    
    // Using GPT-4o-mini with search preview capability to generate accurate, up-to-date URLs
    const response = await openai.chat.completions.create({
      model: SEARCH_PREVIEW_MODEL, // gpt-4o-mini with search preview
      messages: [
        {
          role: "system",
          content: `You are an educational resource specialist with access to current web search results.
            For the given topic, compile a comprehensive list of high-quality learning resources with REAL and ACCURATE URLs.
            It's critical that you provide REAL URLs that actually exist on the web, not example.com or placeholder URLs.
            Use your search capability to find genuine, accessible educational resources.
            
            Generate a JSON response with:
            1. "resources": An array of 6-8 learning resources with the following information for each:
               - "title": The exact title of the resource
               - "url": The precise, complete URL to the resource (must be a real, working URL)
               - "source": The name of the website or provider (e.g., "Coursera", "Khan Academy", etc.)
               - "description": A 1-2 sentence description of what the resource offers
               - "type": The type of resource (e.g., "article", "video", "course", "interactive", "ebook", etc.)
               - "difficulty": The approximate level ("beginner", "intermediate", or "advanced")
            2. "categories": Group the resources into 3-4 logical categories (like "Free Courses", "Interactive Tools", etc.)
            
            Include resources from reputable educational platforms like:
            - Coursera, edX, Udemy, Khan Academy
            - University websites (.edu domains)
            - YouTube channels from established educators
            - Professional organizations relevant to the topic
            - Research journals and academic repositories
            
            Provide diverse resource types for different learning styles, and verify each URL is correct and functional.`
        },
        { role: "user", content: `Find the best learning resources for: ${topic}` }
      ],
      response_format: { type: "json_object" },
    });

    const resourcesData = JSON.parse(response.choices[0].message.content || "{}");
    
    // Get fallback URLs for this topic to use if original URLs are not live
    const fallbackUrlsByType = getFallbackUrls(topic);
    
    // Process and validate each resource's URL
    if (resourcesData.resources && Array.isArray(resourcesData.resources.resources)) {
      const validatedResources = await Promise.all(
        resourcesData.resources.resources.map(async (resource: any) => {
          // Check if the URL is alive
          const isAlive = await isUrlAlive(resource.url);
          
          if (!isAlive) {
            console.log(`URL validation failed for ${resource.url}`);
            
            // Get fallback URLs for this resource type
            const resourceType = (resource.type || 'article').toLowerCase();
            const fallbacks = fallbackUrlsByType[resourceType] || fallbackUrlsByType['article'];
            
            // Use a random fallback URL from the appropriate category
            if (fallbacks && fallbacks.length > 0) {
              const randomIndex = Math.floor(Math.random() * fallbacks.length);
              resource.url = fallbacks[randomIndex];
              resource.isValidated = false;
              resource.note = "Original link was unavailable. Redirected to a general resource for this topic.";
            }
          } else {
            resource.isValidated = true;
          }
          
          return resource;
        })
      );
      
      // Update the resources with validated ones
      resourcesData.resources.resources = validatedResources;
    }

    return resourcesData;
  } catch (error) {
    console.error("Error generating learning resources with links:", error);
    throw new Error(`Failed to generate learning resources with links: ${(error as Error).message}`);
  }
}

/**
 * Generate an equation or formula response
 */
export async function generateEquationResponse(prompt: string): Promise<any> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an educational AI assistant specialized in mathematics and science.
            Generate a response in JSON format that includes:
            1. The mathematical or chemical equation as a LaTeX string
            2. An explanation of the equation (300-500 words). Be thorough and detailed.
            3. The real-world application of this equation with specific examples
            Be precise, comprehensive, and educational.`
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000, // Increased token limit for detailed explanations
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Error generating equation response:", error);
    throw new Error(`Failed to generate equation response: ${(error as Error).message}`);
  }
}

/**
 * Generate multiple images using GPT Image for visualization-centric learning
 */
export async function generateImage(prompt: string, count: number = 3): Promise<string[]> {
  try {
    // Safety check to ensure we don't exceed API limits
    const imageCount = Math.min(count, 4);
    
    // Generate different perspectives or aspects of the topic for multiple images
    const perspectivePrompts = [
      `Create a clear, educational visualization focusing on the main concept of: ${prompt}. Use vibrant colors and clear labeling.`,
      `Create a detailed, step-by-step visual breakdown of how ${prompt} works or is structured. Include numbered steps if applicable.`,
      `Create a visual comparison showing different aspects or applications of ${prompt}. Use a side-by-side format if applicable.`,
      `Create a contextual visualization showing ${prompt} in a real-world setting or application. Include practical examples.`
    ];
    
    // Generate images in parallel with different perspectives
    const imagePromises = perspectivePrompts.slice(0, imageCount).map(async (promptVariation) => {
      try {
        const response = await openai.images.generate({
          model: "gpt-image-1",
          prompt: promptVariation,
          n: 1,
        });
        
        if (!response || !response.data || response.data.length === 0) {
          return null;
        }
        
        const imageData = response.data[0];
        
        if (imageData && imageData.b64_json) {
          return `data:image/png;base64,${imageData.b64_json}`;
        } else if (imageData && imageData.url) {
          return imageData.url;
        }
        
        return null;
      } catch (error) {
        console.error(`Error generating image with prompt variation: ${promptVariation}`, error);
        return null;
      }
    });
    
    const results = await Promise.all(imagePromises);
    const validImages = results.filter((img): img is string => img !== null);
    
    if (validImages.length === 0) {
      // If all images failed, try one more time with a simplified prompt
      const fallbackResponse = await openai.images.generate({
        model: "gpt-image-1",
        prompt: `Create a simple educational visualization about: ${prompt}.`,
        n: 1,
      });
      
      if (fallbackResponse && fallbackResponse.data && fallbackResponse.data.length > 0) {
        const fallbackImageData = fallbackResponse.data[0];
        if (fallbackImageData && fallbackImageData.b64_json) {
          return [`data:image/png;base64,${fallbackImageData.b64_json}`];
        } else if (fallbackImageData && fallbackImageData.url) {
          return [fallbackImageData.url];
        }
      }
      
      throw new Error("Failed to generate any valid images");
    }
    
    return validImages;
  } catch (error) {
    console.error("Error generating images:", error);
    throw new Error(`Failed to generate images: ${(error as Error).message}`);
  }
}

/**
 * Generate descriptive captions for the images to enhance the learning experience
 */
export async function generateImageCaptions(topic: string, imageUrls: string[]): Promise<string[]> {
  try {
    // If there are no images, return an empty array
    if (!imageUrls || imageUrls.length === 0) {
      return [];
    }

    // Generate a caption for each image that explains its educational value
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an educational AI assistant specialized in creating insightful captions for learning materials.
            Generate ${imageUrls.length} distinct, educational captions for visualizations about: "${topic}"
            
            Each caption should:
            1. Be concise but informative (30-50 words)
            2. Explain a different aspect or perspective of the topic
            3. Highlight what the student should look for in the image
            4. Connect the visual to key learning objectives
            
            Format your response as a JSON array of strings, with each string being a complete caption.`
        },
        { role: "user", content: `Generate ${imageUrls.length} educational captions for images about: ${topic}` }
      ],
      response_format: { type: "json_object" },
    });

    // Extract and parse the response
    const parsedResponse = JSON.parse(response.choices[0].message.content || "[]");
    
    // Return the captions, or default captions if something went wrong
    if (Array.isArray(parsedResponse) && parsedResponse.length >= imageUrls.length) {
      return parsedResponse.slice(0, imageUrls.length);
    } else if (parsedResponse.captions && Array.isArray(parsedResponse.captions) && parsedResponse.captions.length >= imageUrls.length) {
      return parsedResponse.captions.slice(0, imageUrls.length);
    } else {
      // Create default captions if the response wasn't formatted correctly
      return imageUrls.map((_, index) => {
        const perspectives = [
          "Key concept visualization showing the main principles",
          "Step-by-step breakdown of the processes involved",
          "Visual comparison of different aspects and applications",
          "Real-world context demonstrating practical implementation"
        ];
        return `${perspectives[index % perspectives.length]} of ${topic}.`;
      });
    }
  } catch (error) {
    console.error("Error generating image captions:", error);
    // Provide basic captions as fallback
    return imageUrls.map((_, index) => `Educational visualization ${index + 1} of ${topic}.`);
  }
}

/**
 * Generate a mind map structure for visual learning
 */
/**
 * Generate educational prompt suggestions based on general or specific topics
 */
export async function generatePromptSuggestions(topic?: string): Promise<string[]> {
  try {
    // If no topic is provided, generate diverse suggestions across subjects
    const promptContext = topic 
      ? `Generate creative, educational prompt suggestions related to: ${topic}`
      : 'Generate diverse, educational prompt suggestions across different subjects';
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an educational AI assistant specialized in creating engaging learning prompts.
            Generate 10 diverse, interesting educational prompts that students or learners might want to explore.
            Each prompt should be specific, actionable, and designed to create rich educational content.
            Format your response as a JSON object with a single key "prompts" containing an array of strings, with each string being a complete prompt.
            
            Examples of good prompts:
            - "Create a mind map about the water cycle and its environmental impact"
            - "Explain quantum computing principles using simple analogies"
            - "Generate a visual representation of how DNA replication works"
            - "Create a step-by-step guide to solving quadratic equations"
            - "Map out the key events and consequences of the Industrial Revolution"
            
            Focus on creating prompts that would generate rich, educational content with opportunities for 
            multiple types of learning elements (text explanations, diagrams, equations, etc.).`
        },
        { role: "user", content: promptContext }
      ],
      response_format: { type: "json_object" },
    });

    const suggestions = JSON.parse(response.choices[0].message.content || '{"prompts":[]}').prompts;
    return Array.isArray(suggestions) ? suggestions : [];
  } catch (error) {
    console.error("Error generating prompt suggestions:", error);
    // On error, return a default set of suggestions rather than failing
    return [
      "Create a mind map about photosynthesis",
      "Explain machine learning in simple terms",
      "Generate a diagram of the water cycle",
      "Visualize the steps of division algorithm",
      "Create notes on quantum computing basics"
    ];
  }
}

export async function generateMindMap(prompt: string): Promise<any> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an educational AI assistant specialized in creating curriculum-focused mind maps and learning pathways.
            Generate a hierarchical mind map in JSON format with the following structure:
            {
              "central_topic": "Main concept or subject name",
              "main_branches": [
                {
                  "topic": "Learning Module 1", 
                  "sub_topics": ["Key concept 1", "Key concept 2", "Key concept 3"]
                },
                {
                  "topic": "Learning Module 2",
                  "sub_topics": ["Key concept 1", "Key concept 2", "Key concept 3"]
                }
              ],
              "learning_pathway": {
                "beginner_topics": ["Topic 1", "Topic 2"],
                "intermediate_topics": ["Topic 3", "Topic 4"],
                "advanced_topics": ["Topic 5", "Topic 6"],
                "recommended_sequence": ["Start with...", "Then learn...", "Finally master..."]
              },
              "core_competencies": ["Skill 1", "Skill 2", "Skill 3"]
            }
            
            Create 5-6 main branches with 3-4 subtopics each that follow a logical curriculum structure.
            The learning_pathway should outline a clear progression from beginner to advanced topics.
            Core_competencies should identify 3-5 key skills that will be mastered.
            Design this as if creating a comprehensive syllabus that guides a student from introduction to mastery.`
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2500, // Increased token limit for more comprehensive curriculum maps
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Error generating mind map:", error);
    throw new Error(`Failed to generate mind map: ${(error as Error).message}`);
  }
}

/**
 * Process a learning question and generate multiple response types
 */
/**
 * Generate a code-based visualization or chart
 */
/**
 * Generate a code-based visualization or chart using the standard GPT-4o model
 */
export async function generateVisualization(prompt: string): Promise<any> {
  try {
    console.log("Generating visualization using GPT-4o");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an AI assistant specialized in creating educational visualizations through code.
            Generate a response in JSON format that includes:
            1. A "chart_type" field specifying the type of chart (e.g., "bar", "line", "scatter", "pie", etc.)
            2. A "title" field with an appropriate title for the chart
            3. A "description" field explaining what the chart shows (200-300 words)
            4. A "data" field containing the data structure needed for the chart
            5. A "code" field with JavaScript code using Recharts to render this visualization
            
            The code should be complete, well-commented, and ready to use in a React component.
            Make sure data values are realistic and educational.
            Focus on creating visualizations that help illustrate concepts clearly.`
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 3000, // Large token limit to ensure complete code generation
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Error generating visualization:", error);
    throw new Error(`Failed to generate visualization: ${(error as Error).message}`);
  }
}

/**
 * Generate a code-based visualization using the specialized OpenAI Assistant
 * This function uses the assistant with code interpreter to create rich visualizations
 */
export async function generateAssistantVisualization(prompt: string): Promise<any> {
  try {
    console.log(`Using assistant ${VISUALIZATION_ASSISTANT_ID} to generate visualization`);
    
    // Step 1: Create a thread
    const thread = await openai.beta.threads.create();
    console.log(`Created thread: ${thread.id}`);
    
    // Step 2: Add a message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Create a visualization to help students understand the following concept: ${prompt}. 
      The visualization should be educational, accurate, and visually appealing.
      Please provide the visualization code in a format that can be used in a React component with Recharts.
      Format your response as a JSON object with these fields:
      - chart_type: The type of chart created
      - title: The title of the visualization
      - description: A detailed explanation of what the visualization shows
      - data: The data structure for the visualization
      - code: The complete React component code to render this visualization
      - insights: 3-5 key insights from this visualization`
    });
    
    // Step 3: Run the assistant on the thread
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: VISUALIZATION_ASSISTANT_ID
    });
    
    // Step 4: Poll for completion
    let completedRun;
    let attempts = 0;
    const maxAttempts = 60; // Maximum number of attempts (10 min at 10s intervals)
    
    while (attempts < maxAttempts) {
      const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runStatus.status === "completed") {
        completedRun = runStatus;
        break;
      } else if (runStatus.status === "failed" || runStatus.status === "cancelled" || runStatus.status === "expired") {
        throw new Error(`Assistant run failed with status: ${runStatus.status}`);
      }
      
      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000));
      attempts++;
    }
    
    if (!completedRun) {
      throw new Error("Assistant run timed out");
    }
    
    // Step 5: Retrieve the response
    const messages = await openai.beta.threads.messages.list(thread.id);
    
    // Find the last assistant message
    const assistantMessages = messages.data.filter(msg => msg.role === "assistant");
    if (assistantMessages.length === 0) {
      throw new Error("No response from assistant");
    }
    
    // Get the most recent response
    const latestMessage = assistantMessages[0];
    
    // Parse the content to extract JSON
    let responseData: any = {};
    
    // Process the message content to find JSON
    for (const content of latestMessage.content) {
      if (content.type === "text") {
        const textValue = content.text.value;
        // Look for JSON content in the response
        const jsonMatch = textValue.match(/```json\n([\s\S]*?)\n```/) || 
                          textValue.match(/```\n([\s\S]*?)\n```/) ||
                          textValue.match(/{[\s\S]*?}/);
                          
        if (jsonMatch) {
          try {
            // Extract and parse the JSON
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            responseData = JSON.parse(jsonStr);
            break;
          } catch (e) {
            console.error("Failed to parse JSON from assistant response:", e);
          }
        } else {
          // If no JSON format is found, create a structured response
          responseData = {
            title: "Visualization from Specialized Assistant",
            description: textValue,
            chart_type: "custom",
            code: "// The assistant provided a text response without structured code"
          };
        }
      }
    }
    
    console.log("Successfully generated visualization with assistant");
    return responseData;
  } catch (error) {
    console.error("Error generating visualization with assistant:", error);
    // Fallback to standard visualization generator
    console.log("Falling back to standard visualization generation");
    return generateVisualization(prompt);
  }
}



export async function processLearningQuestion(question: string): Promise<{
  textResponse: any;
  imageUrls: string[];
  imageCaptions: string[];
  mindMapData: any;
  equationResponse?: any;
  visualization?: any;
}> {
  try {
    // Generate three responses in parallel to save time
    // Now generating multiple images for a visualization-centric learning experience
    const [textResponse, imageUrls, mindMapData] = await Promise.all([
      generateStructuredResponse(question),
      generateImage(question, 3), // Generate 3 different visual perspectives of the topic
      generateMindMap(question)
    ]);

    // Check for different types of specialized content needs
    const scienceKeywords = [
      "equation", "formula", "calculate", "math", "physics",
      "chemistry", "reaction", "biology", "scientific", "theory"
    ];
    
    const dataVisualizationKeywords = [
      "chart", "graph", "plot", "data", "statistics", "trend", 
      "visualization", "compare", "distribution", "percentage", 
      "historical", "timeline", "growth", "relationship"
    ];
    
    // Check if we need specialized content
    const needsEquation = scienceKeywords.some(keyword => 
      question.toLowerCase().includes(keyword)
    );
    
    const needsVisualization = dataVisualizationKeywords.some(keyword => 
      question.toLowerCase().includes(keyword)
    );
    
    // Generate additional content based on question type
    const additionalContentPromises = [];
    
    if (needsEquation) {
      additionalContentPromises.push(generateEquationResponse(question));
    } else {
      additionalContentPromises.push(Promise.resolve(undefined));
    }
    
    if (needsVisualization) {
      // Use the specialized assistant for physics, math, and computers visualizations
      const physicsKeywords = [
        "physics", "motion", "force", "energy", "mechanics", "gravity", "momentum", "waves", 
        "electricity", "magnetism", "quantum", "relativity", "particle", "nuclear"
      ];
      
      const mathKeywords = [
        "mathematics", "calculus", "algebra", "geometry", "trigonometry", "statistics", 
        "probability", "differential", "integral", "function", "series", "vector", "matrix"
      ];
      
      const computerKeywords = [
        "computer", "algorithm", "data structure", "programming", "software", "network", 
        "database", "binary", "memory", "processor", "computation", "code", "architecture"
      ];
      
      // Check if question is related to physics, math, or computers to use the specialized assistant
      const isSpecializedTopic = [...physicsKeywords, ...mathKeywords, ...computerKeywords].some(
        keyword => question.toLowerCase().includes(keyword)
      );
      
      if (isSpecializedTopic) {
        console.log("Using specialized assistant for visualization");
        additionalContentPromises.push(generateAssistantVisualization(question));
      } else {
        console.log("Using standard visualization generator");
        additionalContentPromises.push(generateVisualization(question));
      }
    } else {
      additionalContentPromises.push(Promise.resolve(undefined));
    }
    
    // Wait for all additional content to be generated
    const [equationResponse, visualization] = await Promise.all(additionalContentPromises);

    // Generate captions for each image
    const imageCaptions = await generateImageCaptions(question, imageUrls);

    return {
      textResponse,
      imageUrls,
      imageCaptions,
      mindMapData,
      equationResponse,
      visualization
    };
  } catch (error) {
    console.error("Error processing learning question:", error);
    throw new Error(`Failed to process learning question: ${(error as Error).message}`);
  }
}
